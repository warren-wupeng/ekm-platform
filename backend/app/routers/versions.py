"""Version history endpoints for KnowledgeItem.

  GET  /api/v1/knowledge/{id}/versions               — list versions (desc)
  POST /api/v1/knowledge/{id}/versions               — take a snapshot now
  GET  /api/v1/knowledge/{id}/versions/{v_id}        — single version detail
  GET  /api/v1/knowledge/{id}/versions/{a}/diff/{b}  — unified diff (by id)
  POST /api/v1/knowledge/{id}/rollback/{v_id}        — append new snapshot
                                                        copying v_id's fields

Rollback is append-only: reverting to v3 does NOT truncate history, it
creates v(N+1) with v3's snapshot data + a change_summary noting the source.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.knowledge import KnowledgeItem
from app.models.version import KnowledgeVersion
from app.services.versioning import snapshot_item, unified_diff


router = APIRouter(prefix="/api/v1/knowledge", tags=["versions"])


class SnapshotRequest(BaseModel):
    change_summary: str | None = Field(None, max_length=500)


def _version_dict(v: KnowledgeVersion) -> dict:
    return {
        "id": v.id,
        "version_number": v.version_number,
        "knowledge_item_id": v.knowledge_item_id,
        "name": v.name_snapshot,
        "description": v.description_snapshot,
        "size": v.size_snapshot,
        "change_summary": v.change_summary,
        "created_by_id": v.created_by_id,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


async def _load_item(db, item_id: int) -> KnowledgeItem:
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="knowledge item not found")
    return item


async def _load_version(db, item_id: int, version_id: int) -> KnowledgeVersion:
    v = (await db.execute(
        select(KnowledgeVersion).where(
            KnowledgeVersion.id == version_id,
            KnowledgeVersion.knowledge_item_id == item_id,
        )
    )).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="version not found")
    return v


@router.get("/{item_id}/versions")
async def list_versions(item_id: int, db: DB, user: CurrentUser):
    await _load_item(db, item_id)
    rows = (await db.execute(
        select(KnowledgeVersion)
        .where(KnowledgeVersion.knowledge_item_id == item_id)
        .order_by(KnowledgeVersion.version_number.desc())
    )).scalars().all()
    return {
        "knowledge_item_id": item_id,
        "count": len(rows),
        "versions": [_version_dict(v) for v in rows],
    }


@router.post("/{item_id}/versions", status_code=201)
async def create_snapshot(
    item_id: int,
    payload: SnapshotRequest,
    db: DB,
    user: CurrentUser,
):
    item = await _load_item(db, item_id)
    v = await snapshot_item(
        db, item,
        change_summary=payload.change_summary,
        created_by_id=user.id,
        commit=True,
    )
    return _version_dict(v)


@router.get("/{item_id}/versions/{version_id}")
async def get_version(
    item_id: int, version_id: int, db: DB, user: CurrentUser,
):
    v = await _load_version(db, item_id, version_id)
    out = _version_dict(v)
    # Include the full content text on single-version fetch — list view
    # stays lean, but the detail view often needs it for preview panes.
    out["content_text"] = v.content_text
    out["file_path"] = v.file_path_snapshot
    return out


@router.get("/{item_id}/versions/{a_id}/diff/{b_id}")
async def diff_versions(
    item_id: int, a_id: int, b_id: int, db: DB, user: CurrentUser,
):
    if a_id == b_id:
        raise HTTPException(status_code=400, detail="cannot diff a version against itself")
    a = await _load_version(db, item_id, a_id)
    b = await _load_version(db, item_id, b_id)
    diff = unified_diff(
        a.content_text, b.content_text,
        a_label=f"v{a.version_number}",
        b_label=f"v{b.version_number}",
    )
    return {
        "knowledge_item_id": item_id,
        "from": {"id": a.id, "version_number": a.version_number},
        "to":   {"id": b.id, "version_number": b.version_number},
        "format": "unified-diff",
        "diff": diff,
    }


@router.post("/{item_id}/rollback/{version_id}", status_code=201)
async def rollback_to(
    item_id: int, version_id: int, db: DB, user: CurrentUser,
):
    """Append a new snapshot cloning the target version's fields.

    We also mutate the live KnowledgeItem back to match — a rollback that
    leaves the live state untouched would confuse everyone downstream.
    """
    item = await _load_item(db, item_id)
    target = await _load_version(db, item_id, version_id)

    # Restore live state from the target snapshot.
    item.name        = target.name_snapshot
    item.description = target.description_snapshot
    item.file_path   = target.file_path_snapshot
    item.size        = target.size_snapshot

    # Append a new version recording the rollback. We snapshot from the
    # live item (which now matches the target), not from target directly,
    # so the new row's timestamp + created_by reflect who did the rollback.
    v = await snapshot_item(
        db, item,
        change_summary=f"回滚至 v{target.version_number}",
        created_by_id=user.id,
    )
    await db.commit()
    await db.refresh(v)
    return _version_dict(v)
