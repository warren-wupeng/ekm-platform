"""Sync ES helpers used by Celery workers.

Mirrors the write path of es_client.ESClient without the async machinery.
Celery prefork workers live in plain sync processes — using the sync ES
client avoids asyncio.run overhead per task.
"""
from __future__ import annotations

from typing import Iterable

from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk

from app.core.config import settings
from app.services.es_client import INDEX_CHUNKS, INDEX_ITEMS


def _client() -> Elasticsearch:
    return Elasticsearch(settings.ELASTICSEARCH_URL, request_timeout=15)


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
    success, _ = bulk(client, actions, refresh="wait_for", raise_on_error=True)
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
