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
from collections.abc import Iterable

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from app.core.config import settings

log = logging.getLogger(__name__)

_MAX_CHUNKS_PER_DOC = 1_000_000


def _point_id(doc_id: int, chunk_index: int) -> int:
    return doc_id * _MAX_CHUNKS_PER_DOC + chunk_index


# Module-level singleton — one connection per process, mirrors es_sync._es.
_qc: QdrantClient | None = None


def _client() -> QdrantClient:
    global _qc
    if _qc is None:
        _qc = QdrantClient(url=settings.QDRANT_URL, timeout=15)
    return _qc


def close() -> None:
    """Explicitly close the Qdrant client. Call on shutdown / test teardown."""
    global _qc
    if _qc is not None:
        _qc.close()
        _qc = None


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


def delete_points(point_ids: Iterable[int | str]) -> None:
    c = _client()
    c.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=[int(point_id) for point_id in point_ids],
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
            "document_id": (h.payload or {}).get("document_id"),
            "chunk_index": (h.payload or {}).get("chunk_index"),
            "content": (h.payload or {}).get("content"),
        }
        for h in hits
    ]
