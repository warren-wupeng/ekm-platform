"""Archive admin API.

Endpoints:
  GET    /api/v1/archive/items             list archived knowledge items
                                            - regular user: own uploads only
                                            - km_ops/admin: all
  POST   /api/v1/archive/request           manually archive an item
                                            - owner or admin can archive
  GET    /api/v1/archive/rules             list rules (admin)
  POST   /api/v1/archive/rules             create
  GET    /api/v1/archive/rules/{id}        one
  PATCH  /api/v1/archive/rules/{id}        partial update
  DELETE /api/v1/archive/rules/{id}        hard delete (no soft-delete here —
                                            rules are config, not content)
  POST   /api/v1/archive/rules/{id}/preview  count items that would match now

`preview` lets admins see the blast radius before flipping enabled=true.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import DB, CurrentUser
from app.models.archive import ArchiveRule
from app.models.knowledge import FileType, KnowledgeItem
from app.models.user import UserRole

router = APIRouter(prefix="/api/v1/archive", tags=["archive"])


def _require_admin(user) -> None:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin only",
        )


# ── Archived items listing ─────────────────────────────────────────


@router.get("/items")
async def list_archived_items(
    user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """List archived knowledge items.

    Regular users see only items they uploaded. KM_OPS and ADMIN see all
    (the archive management view).
    """
    q = (
        select(KnowledgeItem)
        .where(KnowledgeItem.is_archived.is_(True))
        .options(selectinload(KnowledgeItem.uploader))
        .order_by(KnowledgeItem.archived_at.desc().nullslast())
    )
    if user.role not in (UserRole.KM_OPS, UserRole.ADMIN):
        q = q.where(KnowledgeItem.uploader_id == user.id)

    # Total for pagination.
    count_q = (
        select(func.count()).select_from(KnowledgeItem).where(KnowledgeItem.is_archived.is_(True))
    )
    if user.role not in (UserRole.KM_OPS, UserRole.ADMIN):
        count_q = count_q.where(KnowledgeItem.uploader_id == user.id)
    total = (await db.execute(count_q)).scalar_one()

    rows = (await db.execute(q.offset((page - 1) * page_size).limit(page_size))).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": item.id,
                "name": item.name,
                "file_type": item.file_type.value
                if hasattr(item.file_type, "value")
                else str(item.file_type),
                "archived_at": item.archived_at.isoformat() if item.archived_at else None,
                "uploader_name": item.uploader.display_name if item.uploader else None,
                "uploader_id": item.uploader_id,
                "category_id": item.category_id,
                "description": item.description,
            }
            for item in rows
        ],
    }


# ── Manual archive request ────────────────────────────────────────


class ArchiveRequestIn(BaseModel):
    knowledge_item_id: int
    reason: str | None = Field(default=None, max_length=2000)


@router.post("/request", status_code=status.HTTP_200_OK)
async def archive_item(
    body: ArchiveRequestIn,
    user: CurrentUser,
    db: DB,
):
    """Manually archive a knowledge item.

    Owner or admin can archive. Already-archived items are a no-op (200).
    """
    item = (
        await db.execute(select(KnowledgeItem).where(KnowledgeItem.id == body.knowledge_item_id))
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="knowledge item not found",
        )
    # Permission: owner, km_ops, or admin can archive
    if item.uploader_id != user.id and user.role not in (UserRole.ADMIN, UserRole.KM_OPS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="only item owner, km_ops, or admin can archive",
        )
    if not item.is_archived:
        item.is_archived = True
        item.archived_at = datetime.now(UTC)
        await db.flush()
        await db.commit()
    return {
        "id": item.id,
        "name": item.name,
        "is_archived": item.is_archived,
        "archived_at": item.archived_at.isoformat() if item.archived_at else None,
    }


# ── Rule CRUD (admin only) ────────────────────────────────────────


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    file_type: FileType | None = None
    inactive_days: int = Field(gt=0, le=3650)  # 10 yrs is more than enough
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v


class RulePatch(BaseModel):
    # All optional — PATCH semantics.
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category_id: int | None = None
    file_type: FileType | None = None
    inactive_days: int | None = Field(default=None, gt=0, le=3650)
    enabled: bool | None = None

    # PATCH needs to distinguish "not sent" from "set to null". We use
    # a sentinel class attribute to flag fields that were explicitly sent
    # as null vs omitted entirely. Pydantic's model_dump(exclude_unset)
    # handles this correctly.


@router.get("/rules")
async def list_rules(db: DB, user: CurrentUser):
    _require_admin(user)
    rows = (
        (await db.execute(select(ArchiveRule).order_by(ArchiveRule.created_at.desc())))
        .scalars()
        .all()
    )
    return {"rules": [r.to_dict() for r in rows]}


@router.post("/rules", status_code=201)
async def create_rule(body: RuleIn, db: DB, user: CurrentUser):
    _require_admin(user)
    r = ArchiveRule(
        name=body.name,
        category_id=body.category_id,
        file_type=body.file_type,
        inactive_days=body.inactive_days,
        enabled=body.enabled,
        created_by_id=user.id,
    )
    db.add(r)
    await db.flush()
    await db.commit()
    return r.to_dict()


@router.get("/rules/{rule_id}")
async def get_rule(rule_id: int, db: DB, user: CurrentUser):
    _require_admin(user)
    r = (
        await db.execute(select(ArchiveRule).where(ArchiveRule.id == rule_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="rule not found")
    return r.to_dict()


@router.patch("/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    body: RulePatch,
    db: DB,
    user: CurrentUser,
):
    _require_admin(user)
    r = (
        await db.execute(select(ArchiveRule).where(ArchiveRule.id == rule_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="rule not found")

    # Only apply fields that were actually sent.
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(r, k, v)
    await db.flush()
    await db.commit()
    return r.to_dict()


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: DB, user: CurrentUser):
    _require_admin(user)
    r = (
        await db.execute(select(ArchiveRule).where(ArchiveRule.id == rule_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="rule not found")
    await db.delete(r)
    await db.commit()


@router.post("/rules/{rule_id}/preview")
async def preview_rule(rule_id: int, db: DB, user: CurrentUser):
    """Count items that currently satisfy this rule's criteria.

    Useful before flipping enabled=true on a newly authored rule — gives
    admins a "this would auto-archive 342 items" number to sanity-check.
    """
    _require_admin(user)
    r = (
        await db.execute(select(ArchiveRule).where(ArchiveRule.id == rule_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="rule not found")

    threshold = datetime.now(UTC) - timedelta(days=r.inactive_days)
    q = (
        select(func.count())
        .select_from(KnowledgeItem)
        .where(
            KnowledgeItem.is_archived.is_(False),
            KnowledgeItem.updated_at <= threshold,
        )
    )
    if r.category_id is not None:
        q = q.where(KnowledgeItem.category_id == r.category_id)
    if r.file_type is not None:
        q = q.where(KnowledgeItem.file_type == r.file_type)
    count = (await db.execute(q)).scalar_one()
    return {
        "rule_id": r.id,
        "inactive_days": r.inactive_days,
        "would_archive_now": count,
    }
