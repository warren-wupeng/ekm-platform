"""Document processing endpoints.

- POST /api/v1/documents/{id}/parse       — enqueue Tika parse + fan-out
- GET  /api/v1/documents/{id}/parse-status — poll parse progress from DB (issue #168)
- GET  /api/v1/documents/{id}/chunks      — peek at parsed chunks (debugging UI)

The actual parsing runs in a Celery worker; this endpoint just returns a
task_id that the UI polls via /api/v1/tasks/{task_id}, or more reliably
via /api/v1/documents/{id}/parse-status which reads the DB directly.
"""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.deps import CurrentUser, DB
from app.models.document import DocumentChunk, DocumentParseRecord, ParseStatus
from app.models.knowledge import KnowledgeItem
from app.models.user import UserRole
from app.worker.tasks import parse_document


log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


async def _wake_worker() -> None:
    """Fire-and-forget HTTP ping to resume a suspended Fly.io worker machine.

    When WORKER_WAKE_URL is set (e.g. ``http://ekm-worker.flycast`` on Fly.io),
    this pings the worker's health endpoint so Fly's proxy auto-starts a
    suspended machine before Celery picks up the queued task.  Any network
    error is swallowed — the task is already in the Redis queue and will be
    processed once the worker is up.
    """
    url = settings.WORKER_WAKE_URL
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.get(url)
    except Exception:  # noqa: BLE001
        log.debug("Worker wake-up ping to %s failed (non-fatal)", url)


@router.post("/{document_id}/parse", status_code=202)
async def trigger_parse(document_id: int, db: DB, user: CurrentUser, background_tasks: BackgroundTasks):
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
        return {
            "task_id": rec.task_id,
            "status": "already_parsing",
            "parse_status_url": f"/api/v1/documents/{document_id}/parse-status",
        }

    async_result = parse_document.delay(document_id)
    background_tasks.add_task(_wake_worker)

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

    return {
        "task_id": async_result.id,
        "status": "queued",
        "parse_status_url": f"/api/v1/documents/{document_id}/parse-status",
    }


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

    # Ownership check. `kg_error` can contain internal paths / stack
    # context from the failing stage (parse/index/vectorize/extract),
    # so we can't let arbitrary logged-in users enumerate other users'
    # document status. Only the uploader (or an admin for ops triage)
    # may read. Share recipients view the doc body via the sharing
    # endpoints, not this pipeline-internals endpoint.
    if item.uploader_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="forbidden")

    return {
        "document_id": document_id,
        "status": item.kg_status.value,
        "stage": item.kg_stage,
        "error": item.kg_error,
        "task_id": item.kg_task_id,
        "started_at": item.kg_started_at.isoformat() if item.kg_started_at else None,
        "completed_at": item.kg_completed_at.isoformat() if item.kg_completed_at else None,
    }


@router.get("/{document_id}/parse-status")
async def get_parse_status(document_id: int, db: DB, user: CurrentUser):
    """Return parse pipeline status for a document, read directly from DB.

    Prefer this over polling /api/v1/tasks/{task_id} — Celery result backend
    stays PENDING during task execution (unless task_track_started=True), but
    DocumentParseRecord transitions to PARSING immediately when the worker
    starts, so this endpoint gives accurate real-time status.

    Returns 404 if parse has never been triggered for this document.
    """
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == document_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="document not found")
    if item.uploader_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="forbidden")

    rec = (await db.execute(
        select(DocumentParseRecord).where(DocumentParseRecord.knowledge_item_id == document_id)
    )).scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="no parse record for this document")

    return {
        "document_id": document_id,
        "status": rec.status.value,
        "task_id": rec.task_id,
        "error": rec.error,
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
