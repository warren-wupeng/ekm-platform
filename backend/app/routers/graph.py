"""Knowledge-graph endpoints (thin — most write-paths live in services).

  GET /api/v1/graph/health          → { ok: bool }
  GET /api/v1/graph/entities/{id}/neighbors?depth=1&limit=50

Write APIs (upsert/delete) land in a later issue once the extraction
pipeline (#47?) is wired up and we know the payload shape we want to
expose.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.deps import CurrentUser
from app.core.graph import graph
from app.services.graph_sync import neighbors


router = APIRouter(prefix="/api/v1/graph", tags=["graph"])


@router.get("/health")
async def graph_health():
    """Cheap check — returns 200 regardless so the caller can branch on `ok`."""
    ok = await graph.healthcheck()
    return {"ok": ok}


@router.get("/entities/{external_id}/neighbors")
async def entity_neighbors(
    external_id: str,
    user: CurrentUser,
    depth: int = Query(1, ge=1, le=3),
    limit: int = Query(50, ge=1, le=200),
):
    if not external_id.strip():
        raise HTTPException(status_code=400, detail="external_id required")
    rows = await neighbors(external_id, depth=depth, limit=limit)
    return {"external_id": external_id, "depth": depth, "neighbors": rows}
