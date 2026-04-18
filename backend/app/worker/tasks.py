"""Celery task registry.

Stubs land here first; real implementations are filled in by:
    #15 parse_document     — Tika pipeline
    #16 index_to_es        — Elasticsearch ingest
    #22 vectorize_chunks   — Qdrant embeddings

Keeping them co-located means one `celery -A app.worker.celery_app` discovers
every task without chasing decorators across the codebase.
"""
from __future__ import annotations

import logging
from typing import Any

from app.worker.celery_app import celery_app


log = logging.getLogger(__name__)


@celery_app.task(name="ekm.health.ping", bind=True)
def ping(self) -> dict[str, Any]:
    """Liveness check. Useful to confirm broker + worker are wired up."""
    return {"status": "ok", "task_id": self.request.id}


@celery_app.task(name="ekm.docs.parse", bind=True, max_retries=3, default_retry_delay=30)
def parse_document(self, document_id: int) -> dict[str, Any]:
    """Extract text + metadata via Tika, persist chunks, then chain
    index_to_es + vectorize_chunks so the downstream stores stay in sync.
    """
    from app.services.document_parse import parse_and_persist

    result = parse_and_persist(int(document_id))

    # Fan out: ES indexing + Qdrant embedding run independently.
    index_to_es.delay(int(document_id))
    vectorize_chunks.delay(int(document_id))

    return {"document_id": document_id, "status": "parsed", **result}


@celery_app.task(name="ekm.docs.index", bind=True, max_retries=3, default_retry_delay=30)
def index_to_es(self, document_id: int) -> dict[str, Any]:
    """Upsert KnowledgeItem + its DocumentChunks into Elasticsearch.

    Runs after parse_document. Idempotent: bulk upsert overwrites prior docs.
    """
    from sqlalchemy import select
    from app.services.document_parse import SyncSession
    from app.services.es_sync import bulk_index_chunks, index_item
    from app.models.document import DocumentChunk
    from app.models.knowledge import KnowledgeItem, TagAssignment, Tag

    document_id = int(document_id)
    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is None:
            return {"document_id": document_id, "status": "not_found"}

        chunks = db.execute(
            select(DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        ).all()

        tag_names = db.execute(
            select(Tag.name)
            .join(TagAssignment, TagAssignment.tag_id == Tag.id)
            .where(TagAssignment.knowledge_item_id == document_id)
        ).scalars().all()

        indexed = bulk_index_chunks(document_id, [(idx, content) for idx, content in chunks])

        index_item(
            document_id,
            {
                "id": document_id,
                "name": item.name,
                "description": item.description,
                "file_type": item.file_type.value if hasattr(item.file_type, "value") else str(item.file_type),
                "mime_type": item.mime_type,
                "uploader_id": item.uploader_id,
                "category_id": item.category_id,
                "tags": list(tag_names),
                "created_at": item.created_at.isoformat() if item.created_at else None,
            },
        )

    log.info("indexed doc=%s chunks=%d", document_id, indexed)
    return {"document_id": document_id, "indexed_chunks": indexed, "status": "indexed"}


@celery_app.task(name="ekm.docs.vectorize", bind=True, max_retries=3, default_retry_delay=60)
def vectorize_chunks(self, document_id: int) -> dict[str, Any]:
    """Embed each DocumentChunk + upsert to Qdrant. Idempotent on re-run."""
    from sqlalchemy import select, update
    from app.services.document_parse import SyncSession
    from app.services.embeddings import embedder
    from app.services.qdrant_client import ensure_collection, upsert_chunks
    from app.models.document import DocumentChunk

    document_id = int(document_id)
    ensure_collection()

    with SyncSession() as db:
        rows = db.execute(
            select(DocumentChunk.id, DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        ).all()

        if not rows:
            return {"document_id": document_id, "status": "no_chunks"}

        vectors = embedder.embed([r.content for r in rows])
        triples = [(r.chunk_index, r.content, vec) for r, vec in zip(rows, vectors)]
        count = upsert_chunks(document_id, triples)

        # Back-link the Qdrant point id onto each chunk for debuggability.
        for r in rows:
            db.execute(
                update(DocumentChunk)
                .where(DocumentChunk.id == r.id)
                .values(vector_id=str(document_id * 1_000_000 + r.chunk_index))
            )
        db.commit()

    log.info("vectorized doc=%s count=%d", document_id, count)
    return {"document_id": document_id, "vectorized": count, "status": "vectorized"}
