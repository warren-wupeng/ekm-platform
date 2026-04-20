"""Admin reparse endpoint.

POST /api/v1/admin/reparse — re-queue historical items through the parse
pipeline so they get DocumentChunks (and downstream ES/Qdrant indexing).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.document import DocumentParseRecord, ParseStatus
from app.models.knowledge import KnowledgeItem
from app.models.user import UserRole
from app.worker.tasks import parse_document

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

MAX_QUEUE = 200


class ReparseRequest(BaseModel):
    item_ids: list[int] | None = Field(default=None, description="Specific item IDs; omit for all unparsed")
    force: bool = Field(default=False, description="True = ignore parse status, re-run everything")


class ReparseResponse(BaseModel):
    queued: int
    skipped: int


@router.post("/reparse", response_model=ReparseResponse, status_code=202)
async def admin_reparse(body: ReparseRequest, db: DB, user: CurrentUser):
    """Re-queue historical files through the Tika parse pipeline."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    # Resolve candidate items.
    if body.item_ids:
        stmt = select(KnowledgeItem.id).where(KnowledgeItem.id.in_(body.item_ids))
    else:
        stmt = select(KnowledgeItem.id)
    all_ids: list[int] = list((await db.execute(stmt)).scalars().all())

    if not body.force:
        # Exclude items that already have status=PARSED.
        parsed_ids_stmt = (
            select(DocumentParseRecord.knowledge_item_id)
            .where(
                DocumentParseRecord.knowledge_item_id.in_(all_ids),
                DocumentParseRecord.status == ParseStatus.PARSED,
            )
        )
        parsed_ids = set((await db.execute(parsed_ids_stmt)).scalars().all())
        to_queue = [i for i in all_ids if i not in parsed_ids]
    else:
        to_queue = all_ids

    if len(to_queue) > MAX_QUEUE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Too many items ({len(to_queue)}). Max {MAX_QUEUE} per call — pass item_ids to batch.",
        )

    for item_id in to_queue:
        parse_document.delay(item_id)

    return ReparseResponse(queued=len(to_queue), skipped=len(all_ids) - len(to_queue))
