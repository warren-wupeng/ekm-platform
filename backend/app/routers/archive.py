"""Archive-rule admin API.

All endpoints require UserRole.ADMIN — ordinary editors shouldn't be able
to configure retention policies. The tick task (worker) reads rules but
never writes them.

Shape:
  GET    /api/v1/archive/rules             list
  POST   /api/v1/archive/rules             create
  GET    /api/v1/archive/rules/{id}        one
  PATCH  /api/v1/archive/rules/{id}        partial update
  DELETE /api/v1/archive/rules/{id}        hard delete (no soft-delete here —
                                            rules are config, not content)
  POST   /api/v1/archive/rules/{id}/preview  count items that would match now

`preview` lets admins see the blast radius before flipping enabled=true.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DB
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


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    file_type: FileType | None = None
    inactive_days: int = Field(gt=0, le=3650)   # 10 yrs is more than enough
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
    rows = (await db.execute(
        select(ArchiveRule).order_by(ArchiveRule.created_at.desc())
    )).scalars().all()
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
    r = (await db.execute(
        select(ArchiveRule).where(ArchiveRule.id == rule_id)
    )).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="rule not found")
    return r.to_dict()


@router.patch("/rules/{rule_id}")
async def update_rule(
    rule_id: int, body: RulePatch, db: DB, user: CurrentUser,
):
    _require_admin(user)
    r = (await db.execute(
        select(ArchiveRule).where(ArchiveRule.id == rule_id)
    )).scalar_one_or_none()
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
    r = (await db.execute(
        select(ArchiveRule).where(ArchiveRule.id == rule_id)
    )).scalar_one_or_none()
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
    r = (await db.execute(
        select(ArchiveRule).where(ArchiveRule.id == rule_id)
    )).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail="rule not found")

    threshold = datetime.now(timezone.utc) - timedelta(days=r.inactive_days)
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
