"""Sync ES helpers used by Celery workers.

Mirrors the write path of es_client.ESClient without the async machinery.
Celery prefork workers live in plain sync processes — using the sync ES
client avoids asyncio.run overhead per task.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk

from app.core.config import settings
from app.services.es_client import INDEX_CHUNKS, INDEX_ITEMS

log = logging.getLogger(__name__)

# Module-level singleton — one connection pool per process, not per call.
# Celery prefork workers each get their own copy after fork, which is fine.
_es: Elasticsearch | None = None


def _client() -> Elasticsearch:
    global _es
    if _es is None:
        _es = Elasticsearch(settings.ELASTICSEARCH_URL, request_timeout=15)
    return _es


def close() -> None:
    """Explicitly close the ES client. Call on shutdown / test teardown."""
    global _es
    if _es is not None:
        _es.close()
        _es = None


def bulk_index_chunks(doc_id: int, chunks: Iterable[tuple[int, str]]) -> int:
    """Upsert an iterable of (chunk_index, content) for one document."""
    client = _client()
    actions = [
        {
            "_op_type": "index",
            "_index": INDEX_CHUNKS,
            "_id": f"{doc_id}:{idx}",
            "_source": {
                "document_id": doc_id,
                "chunk_index": idx,
                "content": content,
            },
        }
        for idx, content in chunks
    ]
    if not actions:
        return 0
    success, errors = bulk(client, actions, refresh="wait_for", raise_on_error=False)
    if errors:
        log.error("ES bulk write failed %d docs: %s", len(errors), errors[:3])
        raise RuntimeError(f"bulk write failed {len(errors)} docs, see logs")
    return success


def index_item(item_id: int, body: dict) -> None:
    client = _client()
    client.index(index=INDEX_ITEMS, id=str(item_id), document=body, refresh="wait_for")


def delete_document(doc_id: int) -> None:
    client = _client()
    client.delete_by_query(
        index=INDEX_CHUNKS,
        body={"query": {"term": {"document_id": doc_id}}},
        refresh=True,
        ignore=[404],
    )
    client.delete(index=INDEX_ITEMS, id=str(doc_id), ignore=[404])
