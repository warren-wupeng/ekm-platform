"""Knowledge-graph search API (Issue #55).

User-facing endpoints for searching entities and finding paths in the
knowledge graph.  Requires standard user authentication (not Agent tokens).

Endpoints:
  GET  /api/v1/kg/entities   full-text search over Entity nodes
  GET  /api/v1/kg/path       shortest path between two entities
"""
import logging
import re

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CurrentUser
from app.core.graph import graph

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/kg", tags=["knowledge-graph"])

# Mirrors graph_sync / kg_extract safe-label check.
_SAFE_ID_RE = re.compile(r"^[\w:.\-]{1,255}$", re.UNICODE)

MAX_LIMIT = 100
MAX_HOPS = 5

# Neo4j fulltext index name.  Created at startup (see _ensure_fulltext_index).
_FT_INDEX = "entity_search"


async def ensure_fulltext_index() -> None:
    """Create the fulltext index if it doesn't exist.

    Called once at app startup (see main.py lifespan).  Idempotent.
    """
    try:
        await graph.run(
            "CALL db.index.fulltext.createNodeIndex("
            "  $name, ['Entity'], ['name', 'label', 'description']"
            ")",
            {"name": _FT_INDEX},
        )
    except Exception as exc:  # noqa: BLE001
        # Index may already exist (createNodeIndex is not IF NOT EXISTS
        # in all Neo4j versions).  Also safe to skip if Neo4j is down —
        # searches will degrade to empty.
        if "already exists" not in str(exc).lower():
            log.warning("Failed to create fulltext index %s: %s", _FT_INDEX, exc)


# ── GET /entities ─────────────────────────────────────────────────────


@router.get("/entities")
async def search_entities(
    user: CurrentUser,
    q: str = Query(..., min_length=1, max_length=500, description="Search query"),
    limit: int = Query(20, ge=1, le=MAX_LIMIT, description="Max results"),
):
    """Full-text search over Entity nodes (name, label, description).

    Returns matched entities with relevance score.  Degrades to empty
    list if Neo4j is down.
    """
    try:
        rows = await graph.run(
            "CALL db.index.fulltext.queryNodes($idx, $query) "
            "YIELD node, score "
            "RETURN node.external_id AS external_id, "
            "       node.label AS label, "
            "       labels(node) AS labels, "
            "       properties(node) AS properties, "
            "       score "
            "LIMIT $lim",
            {"idx": _FT_INDEX, "query": q, "lim": limit},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("kg entity search failed: %s", exc)
        return {"query": q, "entities": []}

    entities = [
        {
            "external_id": r["external_id"],
            "label": r.get("label"),
            "labels": list(r.get("labels") or []),
            "properties": dict(r.get("properties") or {}),
            "score": float(r.get("score", 0.0)),
        }
        for r in rows
        if r.get("external_id")
    ]
    return {"query": q, "entities": entities}


# ── GET /path ─────────────────────────────────────────────────────────


@router.get("/path")
async def shortest_path(
    user: CurrentUser,
    source: str = Query(
        ..., min_length=1, max_length=255, alias="from",
        description="Source entity external_id",
    ),
    target: str = Query(
        ..., min_length=1, max_length=255, alias="to",
        description="Target entity external_id",
    ),
    max_hops: int = Query(3, ge=1, le=MAX_HOPS),
):
    """Find the shortest path between two entities.

    Returns the node chain and relationship types.  Degrades to
    ``found=false`` if Neo4j is down.
    """
    # Validate external_id format to prevent injection via label interpolation.
    if not _SAFE_ID_RE.match(source):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid source entity id format",
        )
    if not _SAFE_ID_RE.match(target):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="invalid target entity id format",
        )

    # All user values are parameterised.  The hop cap is a clamped int
    # literal — safe to interpolate (Cypher can't parameterise path length).
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
    except Exception as exc:  # noqa: BLE001
        log.warning("kg path query failed: %s", exc)
        return {"found": False, "node_ids": [], "rel_types": [], "hops": 0}

    if not rows:
        return {"found": False, "node_ids": [], "rel_types": [], "hops": 0}

    row = rows[0]
    return {
        "found": True,
        "node_ids": list(row.get("node_ids") or []),
        "rel_types": list(row.get("rel_types") or []),
        "hops": int(row.get("hops") or 0),
    }
