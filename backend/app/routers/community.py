"""Community posts & replies.

Post CRUD is kept minimal — this issue scope is replies + likes; posts
exist here just enough to be addressable.

Endpoints:
  GET    /api/v1/posts                          — paginated list
  POST   /api/v1/posts                          — create
  GET    /api/v1/posts/{id}                     — detail (+ first page replies)

  GET    /api/v1/posts/{id}/replies             — paginated, flat
  POST   /api/v1/posts/{id}/replies             — create (optional parent_reply_id, max depth 2)
  DELETE /api/v1/replies/{id}                   — soft-delete (author or admin)
  PUT    /api/v1/replies/{id}/like              — idempotent like
  DELETE /api/v1/replies/{id}/like              — idempotent unlike
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.deps import CurrentUser, DB
from app.models.community import Post, Reply, ReplyLike
from app.models.notification import NotificationType
from app.models.user import User, UserRole
from app.services.notify import dispatch as notify_dispatch


# @username mentions — allow word chars including CJK. Stop at whitespace
# or common punctuation. Deliberately permissive; the DB lookup is the
# real filter.
_MENTION_RE = re.compile(r"@([\w\u4e00-\u9fff]+)")


async def _resolve_mentions(db, content: str, exclude_user_id: int) -> list[User]:
    names = set(_MENTION_RE.findall(content or ""))
    if not names:
        return []
    rows = (await db.execute(
        select(User).where(User.username.in_(names), User.id != exclude_user_id)
    )).scalars().all()
    return list(rows)


def _content_snippet(s: str, n: int = 120) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


# Separate routers so we can mount /posts and /replies with cleanly
# different prefixes while keeping everything in one file.
posts_router   = APIRouter(prefix="/api/v1/posts",   tags=["community"])
replies_router = APIRouter(prefix="/api/v1/replies", tags=["community"])


# ─── Schemas ────────────────────────────────────────────────────────────────
class PostCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    body:  str = Field(..., min_length=1)


class ReplyCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    parent_reply_id: int | None = None


# ─── Helpers ────────────────────────────────────────────────────────────────
def _post_dict(p: Post) -> dict:
    return {
        "id": p.id,
        "author_id": p.author_id,
        "title": p.title,
        "body": p.body,
        "reply_count": p.reply_count,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _reply_dict(r: Reply) -> dict:
    return {
        "id": r.id,
        "post_id": r.post_id,
        "author_id": r.author_id,
        "parent_reply_id": r.parent_reply_id,
        "content": "[deleted]" if r.deleted_at else r.content,
        "like_count": r.like_count,
        "is_deleted": r.deleted_at is not None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def _load_post(db, post_id: int) -> Post:
    p = (await db.execute(
        select(Post).where(Post.id == post_id)
    )).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404, detail="post not found")
    return p


async def _load_reply(db, reply_id: int) -> Reply:
    r = (await db.execute(
        select(Reply).where(Reply.id == reply_id)
    )).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="reply not found")
    return r


# ─── Posts ──────────────────────────────────────────────────────────────────
@posts_router.get("")
async def list_posts(
    db: DB,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    offset = (page - 1) * page_size
    total = (await db.execute(select(func.count()).select_from(Post))).scalar_one()
    rows = (await db.execute(
        select(Post).order_by(Post.created_at.desc()).offset(offset).limit(page_size)
    )).scalars().all()
    return {
        "page": page, "page_size": page_size, "total": total,
        "posts": [_post_dict(p) for p in rows],
    }


@posts_router.post("", status_code=201)
async def create_post(payload: PostCreate, db: DB, user: CurrentUser):
    p = Post(author_id=user.id, title=payload.title, body=payload.body)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _post_dict(p)


@posts_router.get("/{post_id}")
async def get_post(post_id: int, db: DB, user: CurrentUser):
    p = await _load_post(db, post_id)
    return _post_dict(p)


# ─── Replies ────────────────────────────────────────────────────────────────
@posts_router.get("/{post_id}/replies")
async def list_replies(
    post_id: int, db: DB, user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    await _load_post(db, post_id)
    offset = (page - 1) * page_size
    total = (await db.execute(
        select(func.count()).select_from(Reply).where(Reply.post_id == post_id)
    )).scalar_one()
    # Order by created_at ASC so top-level → children read naturally when
    # the client groups by parent_reply_id.
    rows = (await db.execute(
        select(Reply)
        .where(Reply.post_id == post_id)
        .order_by(Reply.created_at.asc())
        .offset(offset).limit(page_size)
    )).scalars().all()
    return {
        "post_id": post_id,
        "page": page, "page_size": page_size, "total": total,
        "replies": [_reply_dict(r) for r in rows],
    }


@posts_router.post("/{post_id}/replies", status_code=201)
async def create_reply(
    post_id: int, payload: ReplyCreate, db: DB, user: CurrentUser,
):
    await _load_post(db, post_id)

    # Enforce max depth = 2 (top-level or one level of children).
    parent = None
    if payload.parent_reply_id is not None:
        parent = (await db.execute(
            select(Reply).where(Reply.id == payload.parent_reply_id)
        )).scalar_one_or_none()
        if parent is None:
            raise HTTPException(status_code=400, detail="parent reply not found")
        if parent.post_id != post_id:
            raise HTTPException(status_code=400, detail="parent reply belongs to a different post")
        if parent.parent_reply_id is not None:
            raise HTTPException(
                status_code=400,
                detail="cannot nest deeper than 2 levels",
            )

    r = Reply(
        post_id=post_id,
        author_id=user.id,
        parent_reply_id=payload.parent_reply_id,
        content=payload.content,
    )
    db.add(r)
    await db.flush()  # need r.id for the notification payload

    # Bump post.reply_count so the feed view doesn't need a JOIN+COUNT.
    post = await _load_post(db, post_id)
    post.reply_count = (post.reply_count or 0) + 1

    # ─── Notifications ──────────────────────────────────────────────────
    # Dispatch three fan-out cases. All go through notify.dispatch which
    # inserts a Notification row (commits with this transaction) and best-
    # effort pushes over WS. We dedupe recipients so the same user never
    # gets two notifications from one reply.
    snippet = _content_snippet(payload.content)
    notified: set[int] = {user.id}  # never notify yourself

    # 1. Post author — "new comment on your post" (only for top-level replies
    #    to keep signal-to-noise reasonable; nested comments notify the
    #    parent-reply author instead, below).
    if parent is None and post.author_id not in notified:
        await notify_dispatch(
            db,
            user_id=post.author_id,
            type=NotificationType.COMMENT,
            title=f"{user.username} 评论了你的帖子",
            payload={
                "post_id": post_id,
                "reply_id": r.id,
                "actor_id": user.id,
                "actor_name": user.username,
                "snippet": snippet,
            },
        )
        notified.add(post.author_id)

    # 2. Parent-reply author — "someone replied to your comment".
    if parent is not None and parent.author_id not in notified:
        await notify_dispatch(
            db,
            user_id=parent.author_id,
            type=NotificationType.COMMENT,
            title=f"{user.username} 回复了你的评论",
            payload={
                "post_id": post_id,
                "reply_id": r.id,
                "parent_reply_id": parent.id,
                "actor_id": user.id,
                "actor_name": user.username,
                "snippet": snippet,
            },
        )
        notified.add(parent.author_id)

    # 3. @mentions — parse out @usernames and ping each distinct user.
    for mentioned in await _resolve_mentions(db, payload.content, user.id):
        if mentioned.id in notified:
            continue
        await notify_dispatch(
            db,
            user_id=mentioned.id,
            type=NotificationType.MENTION,
            title=f"{user.username} 在评论中提到了你",
            payload={
                "post_id": post_id,
                "reply_id": r.id,
                "actor_id": user.id,
                "actor_name": user.username,
                "snippet": snippet,
            },
        )
        notified.add(mentioned.id)

    await db.commit()
    await db.refresh(r)
    return _reply_dict(r)


@replies_router.delete("/{reply_id}", status_code=204)
async def delete_reply(reply_id: int, db: DB, user: CurrentUser):
    r = await _load_reply(db, reply_id)
    if r.deleted_at is not None:
        return None  # already deleted, idempotent
    if r.author_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="only author or admin can delete")
    # Soft-delete: preserve thread shape so children stay anchored.
    r.deleted_at = datetime.now(timezone.utc)

    # Decrement post.reply_count — the reply is gone from the user's view.
    post = (await db.execute(
        select(Post).where(Post.id == r.post_id)
    )).scalar_one_or_none()
    if post is not None:
        post.reply_count = max((post.reply_count or 0) - 1, 0)
    await db.commit()
    return None


# ─── Likes ──────────────────────────────────────────────────────────────────
@replies_router.put("/{reply_id}/like")
async def like_reply(reply_id: int, db: DB, user: CurrentUser):
    """Idempotent: PUT returns the current like state regardless of prior."""
    r = await _load_reply(db, reply_id)
    existing = (await db.execute(
        select(ReplyLike).where(
            ReplyLike.reply_id == reply_id,
            ReplyLike.user_id == user.id,
        )
    )).scalar_one_or_none()
    if existing is not None:
        return {"reply_id": reply_id, "liked": True, "like_count": r.like_count}

    db.add(ReplyLike(reply_id=reply_id, user_id=user.id))
    r.like_count = (r.like_count or 0) + 1

    # Notify the reply author — skip if they liked their own comment.
    if r.author_id != user.id:
        await notify_dispatch(
            db,
            user_id=r.author_id,
            type=NotificationType.LIKE,
            title=f"{user.username} 赞了你的评论",
            payload={
                "reply_id": reply_id,
                "post_id": r.post_id,
                "actor_id": user.id,
                "actor_name": user.username,
            },
        )

    try:
        await db.commit()
    except IntegrityError:
        # Raced with a concurrent PUT — unique constraint caught it.
        await db.rollback()
        # Re-read the fresh count.
        r = await _load_reply(db, reply_id)
        return {"reply_id": reply_id, "liked": True, "like_count": r.like_count}
    return {"reply_id": reply_id, "liked": True, "like_count": r.like_count}


@replies_router.delete("/{reply_id}/like")
async def unlike_reply(reply_id: int, db: DB, user: CurrentUser):
    r = await _load_reply(db, reply_id)
    existing = (await db.execute(
        select(ReplyLike).where(
            ReplyLike.reply_id == reply_id,
            ReplyLike.user_id == user.id,
        )
    )).scalar_one_or_none()
    if existing is None:
        return {"reply_id": reply_id, "liked": False, "like_count": r.like_count}

    await db.delete(existing)
    r.like_count = max((r.like_count or 0) - 1, 0)
    await db.commit()
    return {"reply_id": reply_id, "liked": False, "like_count": r.like_count}


# Expose both routers as a pair so main.py can include_router in one go.
routers = [posts_router, replies_router]
