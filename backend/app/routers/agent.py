"""Agent API (#49 / US-113/US-114).

External-facing REST surface for Agent integrations (e.g. Tom's KG
constructor). Mounted under ``/api/agent``, authenticated with an Agent
Bearer token distinct from user JWTs.

Endpoints:

    GET  /api/agent/knowledge/search   hybrid semantic + full-text search
    POST /api/agent/kg/query           structured KG query (safe Cypher)
    POST /api/agent/kg/node            upsert a KG node
    GET  /api/agent/kg/path            shortest path between two entities

Design notes:

* Each endpoint carries a ``Depends(require_agent_scope(...))`` guard.
  Scope names are narrow (``knowledge:read``, ``kg:read``, ``kg:write``)
  and an Agent can be provisioned with only the subset it needs.
* Cypher safety is delegated to ``services/kg_query.py``. The router's
  only job is to pipe validated Pydantic input into the builder and hand
  the resulting parameterised Cypher to Neo4j.
* Failures from downstream stores (ES, Qdrant, Neo4j) degrade rather than
  500 where possible — Tom's Agent should see a partial or empty result
  instead of an outage. Unexpected errors still bubble.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.agent_deps import AgentCaller, require_agent_scope
from app.core.rate_limit import AGENT_RATE, limiter
from app.core.graph import graph
from app.schemas.agent import (
    KGNode,
    KGNodeUpsertRequest,
    KGNodeUpsertResponse,
    KGPathResponse,
    KGQueryRequest,
    KGQueryResponse,
    SearchHit,
    SearchResponse,
)
from app.services.embeddings import embedder
from app.services.es_client import es
from app.services.graph_sync import upsert_entity
from app.services.kg_query import (
    KGQueryError,
    build_match_query,
    build_path_query,
)
from app.services.qdrant_client import search as qdrant_search


log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["agent"])


# ── /knowledge/search ─────────────────────────────────────────────────

@router.get(
    "/knowledge/search",
    response_model=SearchResponse,
    summary="Hybrid knowledge search (vector + full-text)",
    description=(
        "Run a combined semantic (Qdrant) + full-text (Elasticsearch) "
        "search over indexed knowledge chunks. Results from both indices "
        "are merged and de-duplicated by (document_id, chunk_index), "
        "keeping the higher-scoring match. Partial failures on either "
        "backend degrade to an empty contribution rather than a 500.\n\n"
        "Requires scope: `knowledge:read`."
    ),
)
@limiter.limit(AGENT_RATE)
async def knowledge_search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=500, description="Query string"),
    top_k: int = Query(
        10, ge=1, le=50,
        description="Max hits returned (shared budget across backends).",
    ),
    agent: AgentCaller = Depends(require_agent_scope("knowledge:read")),
) -> SearchResponse:
    # ── vector side ────
    # embedder is sync (LiteLLM is blocking); calling it from an async
    # handler is fine for short queries — the cost is single-digit ms.
    vector_hits: list[dict] = []
    try:
        vectors = embedder.embed([q])
        if vectors:
            vector_hits = qdrant_search(vectors[0], top_k=top_k)
    except Exception as exc:  # noqa: BLE001 — degradable
        log.warning("agent-search vector backend failed: %s", exc)

    # ── full-text side ────
    # Reuse chunk-level ES search so semantic + full-text results have
    # the same shape (doc_id + chunk_index + content + score).
    fulltext_hits: list[dict] = []
    try:
        fulltext_hits = await es.search_chunks(q, size=top_k)
    except Exception as exc:  # noqa: BLE001 — degradable
        log.warning("agent-search fulltext backend failed: %s", exc)

    # ── merge + dedupe ────
    # Dedup key: (document_id, chunk_index). Score comparison uses raw
    # scores which aren't commensurable across backends, so we keep
    # whichever is higher as a proxy for "more confident". It's a known
    # heuristic; a proper RRF rerank is follow-up work.
    merged: dict[tuple[int, int | None], SearchHit] = {}

    for h in vector_hits:
        key = (int(h["document_id"]), h.get("chunk_index"))
        hit = SearchHit(
            document_id=int(h["document_id"]),
            chunk_index=h.get("chunk_index"),
            content=h.get("content"),
            score=float(h.get("score", 0.0)),
            source="vector",
        )
        merged[key] = hit

    for h in fulltext_hits:
        key = (int(h["document_id"]), h.get("chunk_index"))
        new_score = float(h.get("score", 0.0))
        existing = merged.get(key)
        if existing is None or new_score > existing.score:
            merged[key] = SearchHit(
                document_id=int(h["document_id"]),
                chunk_index=h.get("chunk_index"),
                content=h.get("content"),
                score=new_score,
                source="fulltext",
            )

    hits = sorted(merged.values(), key=lambda x: x.score, reverse=True)[:top_k]
    return SearchResponse(query=q, hits=hits)


# ── /kg/query ─────────────────────────────────────────────────────────

@router.post(
    "/kg/query",
    response_model=KGQueryResponse,
    summary="Structured knowledge-graph query",
    description=(
        "Run a structured query over the knowledge graph. The request "
        "describes what to match (entity type, property filters, limit) "
        "and the server builds parameterised Cypher. Raw Cypher strings "
        "are NEVER accepted — every label, relation type, and property "
        "key is validated against a controlled vocabulary.\n\n"
        "Requires scope: `kg:read`."
    ),
)
@limiter.limit(AGENT_RATE)
async def kg_query(
    request: Request,
    body: KGQueryRequest,
    agent: AgentCaller = Depends(require_agent_scope("kg:read")),
) -> KGQueryResponse:
    try:
        built = build_match_query(
            entity_type=body.entity_type,
            where_props=body.where,
            limit=body.limit,
        )
    except KGQueryError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "KG_QUERY_INVALID", "message": str(exc)},
        )

    try:
        rows = await graph.run(built.cypher, built.params)
    except Exception as exc:  # noqa: BLE001
        # Graph down = empty result, not 500 — consistent with graph_sync.
        log.warning("agent kg_query failed: %s", exc)
        return KGQueryResponse(nodes=[])

    nodes = [
        KGNode(
            external_id=r.get("external_id"),
            label=r.get("label"),
            labels=list(r.get("labels") or []),
            properties=dict(r.get("properties") or {}),
        )
        for r in rows
        if r.get("external_id")
    ]
    return KGQueryResponse(nodes=nodes)


# ── /kg/node ──────────────────────────────────────────────────────────

@router.post(
    "/kg/node",
    response_model=KGNodeUpsertResponse,
    summary="Create or update a knowledge-graph node",
    description=(
        "Idempotent MERGE on `external_id`. The entity_type must be one "
        "of the controlled-vocabulary labels; unknown types fall back to "
        "`Entity` and a warning is logged.\n\n"
        "Requires scope: `kg:write`."
    ),
)
@limiter.limit(AGENT_RATE)
async def kg_node_upsert(
    request: Request,
    body: KGNodeUpsertRequest,
    agent: AgentCaller = Depends(require_agent_scope("kg:write")),
) -> KGNodeUpsertResponse:
    # graph_sync.upsert_entity already swallows failures + logs a
    # warning (it's best-effort from the ingestion pipeline's POV).
    # For the Agent API we promote that to a 503: the Agent asked us to
    # do a thing and we can't confirm it happened. Having it silently
    # succeed would break Tom's "did my write land?" contract.
    from app.core.graph import graph as _g
    healthy = await _g.healthcheck()
    if not healthy:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "KG_UNAVAILABLE", "message": "Neo4j is unreachable"},
        )

    await upsert_entity(
        external_id=body.external_id,
        label=body.label,
        entity_type=body.entity_type,
        properties=body.properties or {},
    )
    # upsert_entity doesn't distinguish create vs update — MERGE semantics
    # don't give us that cheaply. Report 'upserted' for honesty.
    return KGNodeUpsertResponse(external_id=body.external_id, status="upserted")


# ── /kg/path ──────────────────────────────────────────────────────────

@router.get(
    "/kg/path",
    response_model=KGPathResponse,
    summary="Shortest path between two KG nodes",
    description=(
        "Find the shortest path (by hop count) between two entities. The "
        "hop budget is capped server-side (see services/kg_query.MAX_HOPS). "
        "Returns `found=false` + empty arrays when no path exists within "
        "the budget.\n\n"
        "Requires scope: `kg:read`."
    ),
)
@limiter.limit(AGENT_RATE)
async def kg_path(
    request: Request,
    source: str = Query(..., min_length=1, max_length=255, alias="source"),
    target: str = Query(..., min_length=1, max_length=255, alias="target"),
    max_hops: int = Query(3, ge=1, le=5),
    relation_type: str | None = Query(None, max_length=64),
    agent: AgentCaller = Depends(require_agent_scope("kg:read")),
) -> KGPathResponse:
    try:
        built = build_path_query(
            source_external_id=source,
            target_external_id=target,
            max_hops=max_hops,
            relation_type=relation_type,
        )
    except KGQueryError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "KG_QUERY_INVALID", "message": str(exc)},
        )

    try:
        rows = await graph.run(built.cypher, built.params)
    except Exception as exc:  # noqa: BLE001
        log.warning("agent kg_path failed: %s", exc)
        return KGPathResponse(found=False)

    if not rows:
        return KGPathResponse(found=False)

    row = rows[0]
    return KGPathResponse(
        found=True,
        node_ids=list(row.get("node_ids") or []),
        rel_types=list(row.get("rel_types") or []),
        hops=int(row.get("hops") or 0),
    )
