"""Tag CRUD + binding to KnowledgeItems.

Endpoints:
  GET    /api/v1/tags                              — list (optional search)
  POST   /api/v1/tags                              — create
  PATCH  /api/v1/tags/{id}                         — partial update
  DELETE /api/v1/tags/{id}                         — delete (cascades assignments)
  POST   /api/v1/tags/bulk-bind                    — non-destructive merge:
                                                      bind N tag names to M items
  POST   /api/v1/knowledge/{id}/tags               — set tags on one item
  DELETE /api/v1/knowledge/{id}/tags/{tag_id}      — unassign one tag

`bulk-bind` is additive by design — it never removes existing tags from
an item. Destructive "replace" is opt-in via POST /knowledge/{id}/tags with
`mode="replace"`.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

import logging

from app.core.deps import CurrentUser, DB
from app.models.knowledge import KnowledgeItem, Tag, TagAssignment
from app.services.es_client import es


_log = logging.getLogger(__name__)


async def _es_index_tag(t: Tag) -> None:
    """Mirror a Tag into ekm_tags for unified search (#42). Best-effort."""
    try:
        await es.index_tag(tag_id=t.id, body={
            "id": t.id,
            "kind": "tag",
            "name": t.name,
            "description": None,
            "slug": None,
            "color": t.color,
            "usage_count": t.usage_count,
        })
    except Exception as exc:  # noqa: BLE001
        _log.warning("ES index_tag failed id=%s: %s", t.id, exc)


async def _es_delete_tag(tag_id: int) -> None:
    try:
        await es.delete_tag(tag_id=tag_id, kind="tag")
    except Exception as exc:  # noqa: BLE001
        _log.warning("ES delete_tag failed id=%s: %s", tag_id, exc)


router = APIRouter(prefix="/api/v1", tags=["tags"])


# ─── Schemas ────────────────────────────────────────────────────────────────
class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str | None = Field(None, max_length=20)


class TagUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    color: str | None = Field(None, max_length=20)


class BulkBindRequest(BaseModel):
    tag_names: list[str] = Field(..., min_length=1, max_length=50)
    knowledge_item_ids: list[int] = Field(..., min_length=1, max_length=500)
    # Missing tags are auto-created (default) vs. rejected — keep the door
    # open for stricter admin flows later.
    create_missing: bool = True


class ItemTagsRequest(BaseModel):
    tags: list[str] = Field(..., max_length=50)
    mode: Literal["add", "replace"] = "add"


def _tag_dict(t: Tag) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "color": t.color,
        "usage_count": t.usage_count,
    }


# ─── Tag CRUD ───────────────────────────────────────────────────────────────
@router.get("/tags")
async def list_tags(
    db: DB,
    user: CurrentUser,
    q: str | None = Query(None, description="Fuzzy name search (prefix)"),
    limit: int = Query(50, ge=1, le=200),
):
    stmt = select(Tag)
    if q:
        stmt = stmt.where(Tag.name.ilike(f"{q}%"))
    stmt = stmt.order_by(Tag.usage_count.desc(), Tag.name).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return {"tags": [_tag_dict(t) for t in rows]}


@router.post("/tags", status_code=201)
async def create_tag(payload: TagCreate, db: DB, user: CurrentUser):
    tag = Tag(name=payload.name, color=payload.color)
    db.add(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="tag name already exists")
    await db.refresh(tag)
    await _es_index_tag(tag)
    return _tag_dict(tag)


@router.patch("/tags/{tag_id}")
async def update_tag(
    tag_id: int, payload: TagUpdate, db: DB, user: CurrentUser,
):
    tag = (await db.execute(
        select(Tag).where(Tag.id == tag_id)
    )).scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=404, detail="tag not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(tag, k, v)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="tag name already exists")
    await db.refresh(tag)
    await _es_index_tag(tag)
    return _tag_dict(tag)


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(tag_id: int, db: DB, user: CurrentUser):
    tag = (await db.execute(
        select(Tag).where(Tag.id == tag_id)
    )).scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=404, detail="tag not found")
    # CASCADE on tag_assignments.tag_id cleans up assignments automatically.
    await db.delete(tag)
    await db.commit()
    await _es_delete_tag(tag_id)
    return None


# ─── Bulk bind ──────────────────────────────────────────────────────────────
@router.post("/tags/bulk-bind")
async def bulk_bind_tags(
    payload: BulkBindRequest, db: DB, user: CurrentUser,
):
    """Add tags to multiple items in one call. Idempotent (non-destructive)."""
    # Verify all items exist up-front so we don't partially-commit bindings.
    found_items = (await db.execute(
        select(KnowledgeItem.id).where(KnowledgeItem.id.in_(payload.knowledge_item_ids))
    )).scalars().all()
    missing = set(payload.knowledge_item_ids) - set(found_items)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"items not found: {sorted(missing)}",
        )

    # Resolve or create tags.
    existing_rows = (await db.execute(
        select(Tag).where(Tag.name.in_(payload.tag_names))
    )).scalars().all()
    existing = {t.name: t for t in existing_rows}

    created: list[Tag] = []
    for name in payload.tag_names:
        if name in existing:
            continue
        if not payload.create_missing:
            raise HTTPException(status_code=404, detail=f"tag not found: {name}")
        t = Tag(name=name)
        db.add(t)
        created.append(t)
    if created:
        await db.flush()
        for t in created:
            existing[t.name] = t

    tag_ids = [existing[n].id for n in payload.tag_names]

    # Figure out which (item, tag) pairs aren't already bound — we only
    # INSERT the new ones so bulk-bind is a true merge.
    already = {
        (r.knowledge_item_id, r.tag_id)
        for r in (await db.execute(
            select(TagAssignment).where(
                TagAssignment.knowledge_item_id.in_(payload.knowledge_item_ids),
                TagAssignment.tag_id.in_(tag_ids),
            )
        )).scalars().all()
    }

    new_assignments: list[TagAssignment] = []
    for item_id in payload.knowledge_item_ids:
        for tag_id in tag_ids:
            if (item_id, tag_id) in already:
                continue
            new_assignments.append(TagAssignment(
                knowledge_item_id=item_id, tag_id=tag_id,
            ))
    if new_assignments:
        db.add_all(new_assignments)
        # Bump usage_count for tags that gained new bindings. Could do this
        # in a single UPDATE ... FROM ..., but tag counts are small.
        gained_per_tag: dict[int, int] = {}
        for a in new_assignments:
            gained_per_tag[a.tag_id] = gained_per_tag.get(a.tag_id, 0) + 1
        if gained_per_tag:
            tags = (await db.execute(
                select(Tag).where(Tag.id.in_(gained_per_tag.keys()))
            )).scalars().all()
            for t in tags:
                t.usage_count = (t.usage_count or 0) + gained_per_tag[t.id]

    await db.commit()
    return {
        "items_touched": len(payload.knowledge_item_ids),
        "tags_resolved": len(payload.tag_names),
        "new_bindings":  len(new_assignments),
        "tags_created":  [_tag_dict(t) for t in created],
    }


# ─── Per-item tag management ────────────────────────────────────────────────
@router.get("/knowledge/{item_id}/tags")
async def list_item_tags(item_id: int, db: DB, user: CurrentUser):
    item = (await db.execute(
        select(KnowledgeItem.id).where(KnowledgeItem.id == item_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    rows = (await db.execute(
        select(Tag)
        .join(TagAssignment, TagAssignment.tag_id == Tag.id)
        .where(TagAssignment.knowledge_item_id == item_id)
        .order_by(Tag.name)
    )).scalars().all()
    return {"tags": [_tag_dict(t) for t in rows]}


@router.post("/knowledge/{item_id}/tags")
async def set_item_tags(
    item_id: int, payload: ItemTagsRequest, db: DB, user: CurrentUser,
):
    """Set (add or replace) tags on a single knowledge item."""
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")

    # Resolve / create tags.
    existing_rows = (await db.execute(
        select(Tag).where(Tag.name.in_(payload.tags))
    )).scalars().all() if payload.tags else []
    existing = {t.name: t for t in existing_rows}

    to_create = [n for n in payload.tags if n not in existing]
    for n in to_create:
        t = Tag(name=n)
        db.add(t)
        existing[n] = t
    if to_create:
        await db.flush()

    desired_tag_ids = {existing[n].id for n in payload.tags}

    current_assigns = (await db.execute(
        select(TagAssignment).where(TagAssignment.knowledge_item_id == item_id)
    )).scalars().all()
    current_tag_ids = {a.tag_id: a for a in current_assigns}

    # Add missing bindings.
    to_add = desired_tag_ids - set(current_tag_ids.keys())
    for tid in to_add:
        db.add(TagAssignment(knowledge_item_id=item_id, tag_id=tid))

    # In replace mode also remove extra bindings.
    to_remove: set[int] = set()
    if payload.mode == "replace":
        to_remove = set(current_tag_ids.keys()) - desired_tag_ids
        for tid in to_remove:
            await db.delete(current_tag_ids[tid])

    # Adjust usage_count deltas.
    for tid in to_add:
        # Resolve fresh row to avoid stale state.
        t = (await db.execute(select(Tag).where(Tag.id == tid))).scalar_one()
        t.usage_count = (t.usage_count or 0) + 1
    for tid in to_remove:
        t = (await db.execute(select(Tag).where(Tag.id == tid))).scalar_one()
        t.usage_count = max((t.usage_count or 0) - 1, 0)

    await db.commit()
    # Return the final tag list so callers can update UI in one round-trip.
    rows = (await db.execute(
        select(Tag)
        .join(TagAssignment, TagAssignment.tag_id == Tag.id)
        .where(TagAssignment.knowledge_item_id == item_id)
        .order_by(Tag.name)
    )).scalars().all()
    return {"tags": [_tag_dict(t) for t in rows]}


@router.delete("/knowledge/{item_id}/tags/{tag_id}", status_code=204)
async def remove_item_tag(
    item_id: int, tag_id: int, db: DB, user: CurrentUser,
):
    assign = (await db.execute(
        select(TagAssignment).where(
            TagAssignment.knowledge_item_id == item_id,
            TagAssignment.tag_id == tag_id,
        )
    )).scalar_one_or_none()
    if assign is None:
        raise HTTPException(status_code=404, detail="tag not assigned to item")
    await db.delete(assign)
    # Decrement usage_count; never below 0.
    tag = (await db.execute(select(Tag).where(Tag.id == tag_id))).scalar_one_or_none()
    if tag is not None:
        tag.usage_count = max((tag.usage_count or 0) - 1, 0)
    await db.commit()
    return None


# Keep linters from whining about unused imports we may add later.
_ = func
