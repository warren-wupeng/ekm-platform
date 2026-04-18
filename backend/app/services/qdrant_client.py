"""Qdrant vector store wrapper.

Collection layout:
  ekm_chunks — one point per DocumentChunk
    id       = stable int (document_id * 1_000_000 + chunk_index)
    vector   = EMBEDDING_DIM floats
    payload  = { document_id, chunk_index, content (trimmed) }

The int ID scheme means a re-parse of the same document predictably
overwrites its prior points without an explicit delete. Up to 1M chunks
per document is more than anyone will ever upload; if we hit that, we
migrate to UUIDs.
"""
from __future__ import annotations

import logging
from typing import Iterable

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance, PointStruct, VectorParams, Filter, FieldCondition, MatchValue,
)

from app.core.config import settings


log = logging.getLogger(__name__)

_MAX_CHUNKS_PER_DOC = 1_000_000


def _point_id(doc_id: int, chunk_index: int) -> int:
    return doc_id * _MAX_CHUNKS_PER_DOC + chunk_index


def _client() -> QdrantClient:
    return QdrantClient(url=settings.QDRANT_URL, timeout=15)


def ensure_collection():
    """Idempotent. Called from FastAPI lifespan and Celery startup."""
    c = _client()
    existing = {col.name for col in c.get_collections().collections}
    if settings.QDRANT_COLLECTION in existing:
        return
    c.create_collection(
        collection_name=settings.QDRANT_COLLECTION,
        vectors_config=VectorParams(size=settings.EMBEDDING_DIM, distance=Distance.COSINE),
    )
    log.info("created Qdrant collection: %s", settings.QDRANT_COLLECTION)


def upsert_chunks(
    doc_id: int,
    items: Iterable[tuple[int, str, list[float]]],
) -> int:
    """Upsert (chunk_index, content, vector) triples for one document."""
    points: list[PointStruct] = []
    for chunk_index, content, vector in items:
        points.append(
            PointStruct(
                id=_point_id(doc_id, chunk_index),
                vector=vector,
                payload={
                    "document_id": doc_id,
                    "chunk_index": chunk_index,
                    # Trim payload — full text lives in Postgres.
                    "content": content[:2000],
                },
            )
        )
    if not points:
        return 0
    c = _client()
    c.upsert(collection_name=settings.QDRANT_COLLECTION, points=points, wait=True)
    return len(points)


def delete_document(doc_id: int):
    c = _client()
    c.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=doc_id))]
        ),
        wait=True,
    )


def search(query_vector: list[float], top_k: int | None = None) -> list[dict]:
    c = _client()
    hits = c.search(
        collection_name=settings.QDRANT_COLLECTION,
        query_vector=query_vector,
        limit=top_k or settings.RAG_TOP_K,
        with_payload=True,
    )
    return [
        {
            "score": h.score,
            "document_id": h.payload.get("document_id"),
            "chunk_index": h.payload.get("chunk_index"),
            "content": h.payload.get("content"),
        }
        for h in hits
    ]
