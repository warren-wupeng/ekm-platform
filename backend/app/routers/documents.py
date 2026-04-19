"""Document processing endpoints.

- POST /api/v1/documents/{id}/parse — enqueue Tika parse + fan-out
- GET  /api/v1/documents/{id}/chunks — peek at parsed chunks (debugging UI)

The actual parsing runs in a Celery worker; this endpoint just returns a
task_id that the UI polls via /api/v1/tasks/{task_id}.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.document import DocumentChunk, DocumentParseRecord, ParseStatus
from app.models.knowledge import KnowledgeItem
from app.worker.tasks import parse_document


router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


@router.post("/{document_id}/parse", status_code=202)
async def trigger_parse(document_id: int, db: DB, user: CurrentUser):
    """Enqueue a Tika parse job. Returns 202 + task_id for polling."""
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == document_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="document not found")
    if not item.file_path:
        raise HTTPException(status_code=400, detail="document has no file")

    # Guard against re-queuing an in-flight job.
    rec = (await db.execute(
        select(DocumentParseRecord).where(DocumentParseRecord.knowledge_item_id == document_id)
    )).scalar_one_or_none()
    if rec and rec.status == ParseStatus.PARSING:
        return {"task_id": rec.task_id, "status": "already_parsing"}

    async_result = parse_document.delay(document_id)

    if rec is None:
        rec = DocumentParseRecord(
            knowledge_item_id=document_id,
            status=ParseStatus.PENDING,
            task_id=async_result.id,
        )
        db.add(rec)
    else:
        rec.status = ParseStatus.PENDING
        rec.task_id = async_result.id
        rec.error = None
    await db.commit()

    return {"task_id": async_result.id, "status": "queued"}


@router.get("/{document_id}/kg-status")
async def get_kg_status(document_id: int, db: DB, user: CurrentUser):
    """Return KG pipeline status for a document (US-048 polling endpoint).

    Frontend polls this on the upload confirmation screen to show
    "处理中 (parse) / 处理中 (extract) / 已完成 / 失败". The payload is
    deliberately small — this is a hot poll path.
    """
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == document_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="document not found")

    return {
        "document_id": document_id,
        "status": item.kg_status.value,
        "stage": item.kg_stage,
        "error": item.kg_error,
        "task_id": item.kg_task_id,
        "started_at": item.kg_started_at.isoformat() if item.kg_started_at else None,
        "completed_at": item.kg_completed_at.isoformat() if item.kg_completed_at else None,
    }


@router.get("/{document_id}/chunks")
async def list_chunks(document_id: int, db: DB, user: CurrentUser, limit: int = 20):
    """Return up to `limit` parsed chunks — handy for QA and for the UI to
    preview what got indexed."""
    rows = (await db.execute(
        select(DocumentChunk)
        .where(DocumentChunk.knowledge_item_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .limit(limit)
    )).scalars().all()

    return {
        "document_id": document_id,
        "count": len(rows),
        "chunks": [
            {"index": c.chunk_index, "content": c.content, "tokens": c.token_count}
            for c in rows
        ],
    }
