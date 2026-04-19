"""Search API — Elasticsearch-backed full-text search.

Endpoints:
    GET /api/v1/search         — unified cross-type search (#42 / US-075)
    GET /api/v1/search/items   — file/document list search (name + description)
    GET /api/v1/search/chunks  — passage-level search for RAG citations

All honor the IK analyzer configured in es_client.py, so Chinese queries
tokenize correctly.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser
from app.services.es_client import es
from app.services.search_aggregator import search_all


router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("")
async def unified_search(
    user: CurrentUser,
    q: str = Query(..., min_length=1, description="search query"),
    types: str | None = Query(
        None,
        description=(
            "Comma-separated content types to search across. "
            "Supported: documents, posts, tags. Default: all three."
        ),
    ),
    size: int = Query(20, ge=1, le=100, description="per-bucket hit cap"),
):
    """Unified full-text search over documents, posts+replies, and tags+categories.

    Returns grouped results:

        {
          "query": "关键词",
          "total": 42,
          "results": {
            "documents": { "total": 12, "hits": [...] },
            "posts":     { "total": 20, "hits": [...] },
            "tags":      { "total": 10, "hits": [...] }
          }
        }

    Per-bucket failures (e.g. a missing index) are logged and degraded to
    an empty bucket rather than a 500 — a partial result beats no result.
    """
    requested = [t for t in (types or "").split(",") if t.strip()] or None
    return await search_all(q, types=requested, size=size)


@router.get("/items")
async def search_items(
    user: CurrentUser,
    q: str = Query(..., min_length=1, description="search query"),
    size: int = Query(20, ge=1, le=100),
    file_type: str | None = Query(None),
):
    hits = await es.search_items(q, size=size, file_type=file_type)
    return {"query": q, "count": len(hits), "hits": hits}


@router.get("/chunks")
async def search_chunks(
    user: CurrentUser,
    q: str = Query(..., min_length=1),
    size: int = Query(10, ge=1, le=50),
):
    hits = await es.search_chunks(q, size=size)
    return {"query": q, "count": len(hits), "hits": hits}
