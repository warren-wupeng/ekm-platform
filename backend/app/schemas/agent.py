"""Pydantic schemas for the Agent API (`/api/agent/*`).

Schemas here are the contract Tom's Agent (and others) build against.
Keep them conservative — a loose schema today is a backward-compat
nightmare tomorrow.

NOTE: Do NOT add ``from __future__ import annotations`` to this file.
Pydantic v2's ForwardRef resolution breaks with postponed evaluation in
certain import-order scenarios, causing ``/openapi.json`` to 500.
Python 3.10+ supports all the syntax we need natively.
"""
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ── /knowledge/search ─────────────────────────────────────────────────


class SearchHit(BaseModel):
    """One document+chunk match. Score is vendor-specific (Qdrant cosine
    for vector hits, ES bm25 for full-text)."""
    model_config = ConfigDict(extra="ignore")

    document_id: int
    chunk_index: int | None = None
    content: str | None = None
    score: float
    source: str = Field(
        description="Which index produced the hit: 'vector' or 'fulltext'.",
    )


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]


# ── /kg/query ─────────────────────────────────────────────────────────


class KGQueryRequest(BaseModel):
    """Structured query spec. We translate this into safe Cypher server-side.

    Example::

        {
          "entity_type": "Concept",
          "where": {"label": "RAG"},
          "limit": 20
        }
    """
    model_config = ConfigDict(extra="forbid")

    entity_type: str | None = Field(
        default=None,
        description="Controlled vocabulary: Concept, Person, Organization, …",
        max_length=64,
    )
    where: dict[str, Any] | None = Field(
        default=None,
        description="Exact-match filters on node properties (AND'd).",
    )
    limit: int | None = Field(
        default=None, ge=1, le=200,
        description="Max nodes returned. Clamped server-side.",
    )


class KGNode(BaseModel):
    external_id: str
    label: str | None = None
    labels: list[str] = Field(default_factory=list)
    properties: dict[str, Any] = Field(default_factory=dict)


class KGQueryResponse(BaseModel):
    nodes: list[KGNode]


# ── /kg/node ──────────────────────────────────────────────────────────


class KGNodeUpsertRequest(BaseModel):
    """Create or update a KG node. Idempotent on (external_id).

    External Agents extracting entities from docs they don't own should
    NOT be able to create arbitrary nodes — scope `kg:write` gates this.
    """
    model_config = ConfigDict(extra="forbid")

    external_id: str = Field(min_length=1, max_length=255)
    label: str = Field(min_length=1, max_length=500)
    entity_type: str = Field(min_length=1, max_length=64)
    properties: dict[str, Any] = Field(default_factory=dict)


class KGNodeUpsertResponse(BaseModel):
    external_id: str
    status: str = Field(description="'created' or 'updated'. Best-effort.")


# ── /kg/path ──────────────────────────────────────────────────────────


class KGPathResponse(BaseModel):
    """Shortest path between two entities. ``found=False`` means no path
    within the requested hop budget — returned with an empty node list."""
    found: bool
    node_ids: list[str] = Field(default_factory=list)
    rel_types: list[str] = Field(default_factory=list)
    hops: int = 0
