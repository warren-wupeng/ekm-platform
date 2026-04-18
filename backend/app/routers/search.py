"""Search API — Elasticsearch-backed full-text search.

Two endpoints:
    GET /api/v1/search/items   — file/document list search (name + description)
    GET /api/v1/search/chunks  — passage-level search for RAG citations

Both honor the IK analyzer configured in es_client.py, so Chinese queries
tokenize correctly.
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser
from app.services.es_client import es


router = APIRouter(prefix="/api/v1/search", tags=["search"])


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
