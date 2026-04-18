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
def parse_document(self, document_id: str) -> dict[str, Any]:
    """Stub — filled in by #15. Extracts text + metadata via Tika,
    persists chunks, then chains index_to_es + vectorize_chunks."""
    log.info("parse_document stub invoked for %s", document_id)
    return {"document_id": document_id, "status": "pending_impl"}


@celery_app.task(name="ekm.docs.index", bind=True, max_retries=3, default_retry_delay=30)
def index_to_es(self, document_id: str) -> dict[str, Any]:
    """Stub — filled in by #16. Upserts document into Elasticsearch with
    IK analyzer for CJK search."""
    log.info("index_to_es stub invoked for %s", document_id)
    return {"document_id": document_id, "status": "pending_impl"}


@celery_app.task(name="ekm.docs.vectorize", bind=True, max_retries=3, default_retry_delay=30)
def vectorize_chunks(self, document_id: str) -> dict[str, Any]:
    """Stub — filled in by #22. Embeds chunks and pushes to Qdrant."""
    log.info("vectorize_chunks stub invoked for %s", document_id)
    return {"document_id": document_id, "status": "pending_impl"}
