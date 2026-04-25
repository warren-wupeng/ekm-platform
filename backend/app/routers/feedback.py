"""Chat feedback — user-side submit + admin-side list.

POST /api/v1/chat/{session_id}/feedback
    { message_id?, rating: "up"|"down", comment?, query?, answer?, sources? }
    201 → { id, ... }

GET  /api/v1/admin/feedback
    ?page=&page_size=&rating=&session_id=&user_id=&since=&until=
    200 → paginated list

The user endpoint is append-only — we don't collapse duplicate 👍s on the
same message because the product surface is "how did this specific reply
feel", not "what's the current thumb state". If the frontend wants toggle
semantics it can issue a new feedback record; the admin view shows history.
Admins only see their own tenant's data once RBAC scopes land; for now any
user with UserRole.ADMIN can read the whole table.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select

from app.core.deps import DB, CurrentUser
from app.models.feedback import ChatFeedback, FeedbackRating
from app.models.user import UserRole

# Two routers so we can mount /chat/...feedback and /admin/feedback cleanly.
chat_feedback_router = APIRouter(prefix="/api/v1/chat", tags=["chat-feedback"])
admin_feedback_router = APIRouter(prefix="/api/v1/admin", tags=["admin-feedback"])


# ─── Schemas ────────────────────────────────────────────────────────────────
class FeedbackCreate(BaseModel):
    message_id: str | None = Field(None, max_length=64)
    rating: FeedbackRating
    comment: str | None = Field(None, max_length=2000)
    # Optional snapshots — the frontend already has these in memory after
    # the streamed response, so sending them along is cheap and saves us a
    # round-trip to re-query the RAG stack.
    query: str | None = Field(None, max_length=4000)
    answer: str | None = Field(None, max_length=20_000)
    sources: list[dict] | None = None


def _feedback_dict(f: ChatFeedback) -> dict[str, Any]:
    return {
        "id": f.id,
        "session_id": f.session_id,
        "message_id": f.message_id,
        "user_id": f.user_id,
        "rating": f.rating.value,
        "comment": f.comment,
        "query": f.query_snapshot,
        "answer": f.answer_snapshot,
        "sources": f.sources_snapshot,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


# ─── User-side submit ──────────────────────────────────────────────────────
@chat_feedback_router.post("/{session_id}/feedback", status_code=201)
async def submit_feedback(
    session_id: str,
    payload: FeedbackCreate,
    db: DB,
    user: CurrentUser,
):
    if len(session_id) > 64:
        raise HTTPException(status_code=400, detail="session_id too long (max 64)")

    f = ChatFeedback(
        session_id=session_id,
        message_id=payload.message_id,
        user_id=user.id,
        rating=payload.rating,
        comment=payload.comment,
        query_snapshot=payload.query,
        answer_snapshot=payload.answer,
        sources_snapshot=payload.sources,
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return _feedback_dict(f)


# ─── Admin-side list ───────────────────────────────────────────────────────
@admin_feedback_router.get("/feedback")
async def list_feedback(
    db: DB,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    rating: FeedbackRating | None = None,
    session_id: str | None = None,
    user_id: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="admin only")

    conds = []
    if rating is not None:
        conds.append(ChatFeedback.rating == rating)
    if session_id is not None:
        conds.append(ChatFeedback.session_id == session_id)
    if user_id is not None:
        conds.append(ChatFeedback.user_id == user_id)
    if since is not None:
        conds.append(ChatFeedback.created_at >= since)
    if until is not None:
        conds.append(ChatFeedback.created_at <= until)
    where = and_(*conds) if conds else None

    count_q = select(func.count()).select_from(ChatFeedback)
    rows_q = select(ChatFeedback).order_by(ChatFeedback.created_at.desc())
    if where is not None:
        count_q = count_q.where(where)
        rows_q = rows_q.where(where)

    total = (await db.execute(count_q)).scalar_one()
    offset = (page - 1) * page_size
    rows = (await db.execute(rows_q.offset(offset).limit(page_size))).scalars().all()

    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "feedback": [_feedback_dict(r) for r in rows],
    }


@admin_feedback_router.get("/feedback/stats")
async def feedback_stats(db: DB, user: CurrentUser):
    """Lightweight summary for dashboards: counts by rating."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="admin only")

    rows = (
        await db.execute(select(ChatFeedback.rating, func.count()).group_by(ChatFeedback.rating))
    ).all()
    by_rating = {r.value: 0 for r in FeedbackRating}
    for rating_val, c in rows:
        by_rating[rating_val.value] = c
    total = sum(by_rating.values())
    return {
        "total": total,
        "up": by_rating["up"],
        "down": by_rating["down"],
        # Simple ratio; guard against 0/0 so the frontend doesn't have to.
        "up_ratio": (by_rating["up"] / total) if total else None,
    }


routers = [chat_feedback_router, admin_feedback_router]
