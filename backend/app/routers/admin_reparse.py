"""Admin reparse endpoint.

POST /api/v1/admin/reparse — re-queue historical items through the parse
pipeline so they get DocumentChunks (and downstream ES/Qdrant indexing).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.core.rate_limit import limiter
from app.models.document import DocumentParseRecord, ParseStatus
from app.models.knowledge import KnowledgeItem
from app.models.sharing import AuditAction, AuditLog
from app.models.user import UserRole
from app.worker.tasks import parse_document

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

MAX_QUEUE = 200
_SKIP_STATUSES = {ParseStatus.PARSED, ParseStatus.PARSING}


class ReparseRequest(BaseModel):
    item_ids: list[int] | None = Field(default=None, description="Specific item IDs; omit for all unparsed")
    force: bool = Field(default=False, description="True = ignore parse status, re-run everything")


class ReparseResponse(BaseModel):
    queued: int
    skipped: int
    dispatch_failed: int = 0


@router.post("/reparse", response_model=ReparseResponse, status_code=202)
@limiter.limit("10/minute")
async def admin_reparse(request: Request, body: ReparseRequest, db: DB, user: CurrentUser):
    """Re-queue historical files through the Tika parse pipeline."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    # Resolve candidate items.
    if body.item_ids is not None:
        # Explicit list — even [] is honoured (0 items queued).
        stmt = select(KnowledgeItem.id).where(KnowledgeItem.id.in_(body.item_ids))
    else:
        # No filter — cap at DB level to avoid full-table load.
        stmt = select(KnowledgeItem.id).limit(MAX_QUEUE + 1)

    all_ids: list[int] = list((await db.execute(stmt)).scalars().all())

    if not body.force:
        # Exclude items that are PARSED or currently PARSING.
        if all_ids:
            skip_stmt = (
                select(DocumentParseRecord.knowledge_item_id)
                .where(
                    DocumentParseRecord.knowledge_item_id.in_(all_ids),
                    DocumentParseRecord.status.in_(_SKIP_STATUSES),
                )
            )
            skip_ids = set((await db.execute(skip_stmt)).scalars().all())
        else:
            skip_ids = set()
        to_queue = [i for i in all_ids if i not in skip_ids]
    else:
        to_queue = all_ids

    if len(to_queue) > MAX_QUEUE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many items ({len(to_queue)}). Max {MAX_QUEUE} per call — pass item_ids to batch.",
        )

    # Dispatch with partial-failure tolerance.
    queued = 0
    dispatch_failed = 0
    for item_id in to_queue:
        try:
            parse_document.delay(item_id)
            queued += 1
        except Exception:
            log.exception("Failed to dispatch parse for item %s", item_id)
            dispatch_failed += 1

    # Audit trail.
    db.add(AuditLog(
        actor_id=user.id,
        action=AuditAction.UPDATE,
        resource_type="admin_reparse",
        detail={
            "queued": queued,
            "skipped": len(all_ids) - len(to_queue),
            "dispatch_failed": dispatch_failed,
            "force": body.force,
            "item_ids": body.item_ids,
        },
    ))
    await db.commit()

    return ReparseResponse(
        queued=queued,
        skipped=len(all_ids) - len(to_queue),
        dispatch_failed=dispatch_failed,
    )
