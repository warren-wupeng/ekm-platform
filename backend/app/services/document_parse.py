"""Document parsing pipeline (sync core — called from Celery task).

Flow per document:
    1. Load KnowledgeItem + its stored file_path
    2. Tika → (text, metadata)
    3. chunk_text → N chunks
    4. Upsert DocumentParseRecord + DocumentChunk rows
    5. Return chunk ids so the caller can chain index_to_es / vectorize_chunks

We keep DB work in a sync SQLAlchemy session (simpler inside Celery workers)
and run the async Tika call via asyncio.run — Celery workers spawn fresh
processes, so there's no event-loop conflict.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.models.document import DocumentChunk, DocumentParseRecord, ParseStatus
from app.models.knowledge import KnowledgeItem
from app.services.chunker import chunk_text
from app.services.tika_client import tika, TikaError


log = logging.getLogger(__name__)


# Sync engine/session strictly for worker-side DB access. The FastAPI app
# continues to use the async engine from app.core.database.
_SYNC_URL = settings.DATABASE_URL.replace("postgresql+asyncpg", "postgresql+psycopg2")
_sync_engine = create_engine(_SYNC_URL, pool_pre_ping=True)
SyncSession = sessionmaker(bind=_sync_engine, autoflush=False, expire_on_commit=False)


def _run(coro):
    """Run an async coroutine from sync code. Safe inside Celery prefork workers."""
    return asyncio.run(coro)


def parse_and_persist(document_id: int) -> dict[str, Any]:
    """Parse the document and write chunks to Postgres. Idempotent.

    Called by the `ekm.docs.parse` Celery task. Returns a summary the task
    can surface via AsyncResult.
    """
    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is None:
            raise ValueError(f"KnowledgeItem {document_id} not found")
        if not item.file_path:
            raise ValueError(f"KnowledgeItem {document_id} has no file_path")

        record = _upsert_record(db, document_id, status=ParseStatus.PARSING)
        db.commit()

        try:
            text, meta = _run(tika.extract(item.file_path))
        except TikaError as e:
            log.exception("tika failed for doc %s", document_id)
            record.status = ParseStatus.FAILED
            record.error = str(e)
            db.commit()
            raise

        chunks = chunk_text(text)
        log.info("parsed doc=%s chars=%d chunks=%d", document_id, len(text), len(chunks))

        # Replace any prior chunks — parse is idempotent on re-run.
        db.execute(delete(DocumentChunk).where(DocumentChunk.knowledge_item_id == document_id))
        db.flush()

        rows = [
            DocumentChunk(
                knowledge_item_id=document_id,
                chunk_index=c.index,
                content=c.content,
                token_count=c.char_count,  # char-count proxy; replaced in #22
            )
            for c in chunks
        ]
        db.add_all(rows)
        db.flush()
        chunk_ids = [r.id for r in rows]

        record.status = ParseStatus.PARSED
        record.error = None
        record.metadata_json = json.dumps(_trim_meta(meta), ensure_ascii=False)
        db.commit()

        return {
            "document_id": document_id,
            "chunk_count": len(rows),
            "chunk_ids": chunk_ids,
            "chars": len(text),
        }


def _upsert_record(db: Session, document_id: int, status: ParseStatus) -> DocumentParseRecord:
    rec = db.execute(
        select(DocumentParseRecord).where(DocumentParseRecord.knowledge_item_id == document_id)
    ).scalar_one_or_none()
    if rec is None:
        rec = DocumentParseRecord(knowledge_item_id=document_id, status=status)
        db.add(rec)
        db.flush()
    else:
        rec.status = status
    return rec


# Tika returns a huge metadata dict with a lot of noise. Keep what's useful
# to the UI (title, author, pages, content-type) and drop the rest.
_META_KEEP = {
    "dc:title", "title",
    "dc:creator", "Author", "meta:author",
    "Content-Type", "content-type",
    "xmpTPg:NPages", "meta:page-count",
    "Content-Length",
}


def _trim_meta(meta: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in meta.items() if k in _META_KEEP}
