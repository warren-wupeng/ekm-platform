"""Chunk history API (Issue #43).

GET /api/v1/documents/{id}/chunks/history — all chunk versions for audit.
"""
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.document import DocumentChunk
from app.models.knowledge import KnowledgeItem
from app.models.user import UserRole

router = APIRouter(prefix="/api/v1/documents", tags=["chunk-history"])


class ChunkHistoryItem(BaseModel):
    id: int
    chunk_index: int
    content_hash: str | None
    version: int
    is_current: bool
    doc_version: int
    token_count: int
    created_at: str | None

    model_config = {"from_attributes": True}


@router.get("/{document_id}/chunks/history")
async def get_chunk_history(
    document_id: int,
    db: DB,
    user: CurrentUser,
    version: int | None = Query(None, ge=1, description="Filter by doc_version"),
):
    """Return all chunk versions for a document (including retired)."""
    # Ownership check: uploader or ADMIN.
    item = await db.get(KnowledgeItem, document_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if item.uploader_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    stmt = (
        select(DocumentChunk)
        .where(DocumentChunk.knowledge_item_id == document_id)
        .order_by(DocumentChunk.doc_version.desc(), DocumentChunk.chunk_index.asc())
    )
    if version is not None:
        stmt = stmt.where(DocumentChunk.doc_version == version)

    rows = (await db.execute(stmt)).scalars().all()

    return {
        "document_id": document_id,
        "total": len(rows),
        "items": [
            {
                "id": c.id,
                "chunk_index": c.chunk_index,
                "content_hash": c.content_hash,
                "version": c.version,
                "is_current": c.is_current,
                "doc_version": c.doc_version,
                "token_count": c.token_count,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ],
    }
