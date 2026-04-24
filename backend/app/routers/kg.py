"""Knowledge-graph search API (Issue #55).

User-facing endpoints for searching entities and finding paths in the
knowledge graph.  Requires standard user authentication (not Agent tokens).

Endpoints:
  GET  /api/v1/kg/entities   full-text search over Entity nodes
  GET  /api/v1/kg/path       shortest path between two entities
"""

import logging

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.deps import CurrentUser
from app.core.graph import graph
from app.services.kg_search import (
    MAX_HOPS,
    MAX_LIMIT,
    SAFE_ID_RE,
    LuceneEscapeError,
    escape_lucene,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/kg", tags=["knowledge-graph"])

_FT_INDEX_NAME = "entity_search"


# ── Response models ──────────────────────────────────────────────────


class EntityHit(BaseModel):
    external_id: str
    label: str | None = None
    entity_type: str | None = None
    score: float = 0.0


class EntitySearchResponse(BaseModel):
    query: str
    entities: list[EntityHit]


class PathResponse(BaseModel):
    found: bool
    node_ids: list[str] = Field(default_factory=list)
    rel_types: list[str] = Field(default_factory=list)
    hops: int = 0


# ── Startup ──────────────────────────────────────────────────────────


async def ensure_fulltext_index() -> None:
    """Create the fulltext index if it doesn't exist.

    Called once at app startup (see main.py lifespan).  Idempotent.
    Uses Cypher DDL syntax (Neo4j 4.x+) with IF NOT EXISTS.
    """
    try:
        await graph.run(
            "CREATE FULLTEXT INDEX entity_search IF NOT EXISTS "
            "FOR (n:Entity) ON EACH [n.name, n.label, n.description]"
        )
    except Exception as exc:
        log.warning("Failed to create fulltext index %s: %s", _FT_INDEX_NAME, exc)


# ── GET /entities ────────────────────────────────────────────────────


@router.get("/entities", response_model=EntitySearchResponse)
async def search_entities(
    user: CurrentUser,
    q: str = Query(..., min_length=1, max_length=500, description="Search query"),
    limit: int = Query(20, ge=1, le=MAX_LIMIT, description="Max results"),
) -> EntitySearchResponse:
    """Full-text search over Entity nodes (name, label, description).

    Returns matched entities with relevance score.  Degrades to empty
    list if Neo4j is down.
    """
    try:
        safe_q = escape_lucene(q)
    except LuceneEscapeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    try:
        rows = await graph.run(
            "CALL db.index.fulltext.queryNodes($idx, $query) "
            "YIELD node, score "
            "RETURN node.external_id AS external_id, "
            "       node.label AS label, "
            "       node.entity_type AS entity_type, "
            "       score "
            "LIMIT $lim",
            {"idx": _FT_INDEX_NAME, "query": safe_q, "lim": limit},
        )
    except Exception as exc:
        log.warning("kg entity search failed: %s", exc)
        return EntitySearchResponse(query=q, entities=[])

    entities = [
        EntityHit(
            external_id=r["external_id"],
            label=r.get("label"),
            entity_type=r.get("entity_type"),
            score=float(r.get("score", 0.0)),
        )
        for r in rows
        if r.get("external_id")
    ]
    return EntitySearchResponse(query=q, entities=entities)


# ── GET /path ────────────────────────────────────────────────────────


@router.get("/path", response_model=PathResponse)
async def shortest_path(
    user: CurrentUser,
    source: str = Query(
        ...,
        min_length=1,
        max_length=255,
        alias="from",
        description="Source entity external_id",
    ),
    target: str = Query(
        ...,
        min_length=1,
        max_length=255,
        alias="to",
        description="Target entity external_id",
    ),
    max_hops: int = Query(3, ge=1, le=MAX_HOPS),
) -> PathResponse:
    """Find the shortest path between two entities.

    Returns the node chain and relationship types.  Degrades to
    ``found=false`` if Neo4j is down.
    """
    if not SAFE_ID_RE.match(source):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid source entity id format",
        )
    if not SAFE_ID_RE.match(target):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid target entity id format",
        )

    cypher = (
        "MATCH (a:Entity {external_id: $src}), "
        "(b:Entity {external_id: $dst}) "
        f"MATCH p = shortestPath((a)-[*1..{max_hops}]-(b)) "
        "RETURN [n IN nodes(p) | n.external_id] AS node_ids, "
        "[r IN relationships(p) | type(r)] AS rel_types, "
        "length(p) AS hops"
    )

    try:
        rows = await graph.run(cypher, {"src": source, "dst": target})
    except Exception as exc:
        log.warning("kg path query failed: %s", exc)
        return PathResponse(found=False)

    if not rows:
        return PathResponse(found=False)

    row = rows[0]
    return PathResponse(
        found=True,
        node_ids=list(row.get("node_ids") or []),
        rel_types=list(row.get("rel_types") or []),
        hops=int(row.get("hops") or 0),
    )
