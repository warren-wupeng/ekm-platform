"""LLM-based knowledge-graph extraction — Schema.org alignment via Tom's library.

Turns parsed chunks into entities + relations, writes them to Postgres
(`kg_nodes` / `kg_edges` — the canonical store), then mirrors to Neo4j
for traversal. Also creates a provenance edge:

    (entity) -[:MENTIONED_IN]-> (:Document {id: knowledge_item_id})

so any entity can be traced back to the documents that mention it.

Design choices:

1. Tom's `KnowledgeGraphConstructor` does the heavy lifting.
   We delegate prompt engineering + JSON parsing + Schema.org type
   mapping to `app.vendor.tom_kg`. The extractor aligns entities to the
   Schema.org ontology (Person, Organization, Place, Product, …) and
   relations to Schema.org properties (worksFor, location, founder, …).

2. Chunk-level LLM calls, preserved from the previous design.
   One completion per chunk, not one giant prompt. Smaller prompts =
   higher accuracy, faster retries, easier cost control. Tom's library
   keeps internal dedup across `add_text()` calls, so cross-chunk
   entity coreference still works without us doing anything special.

3. Bounded cost.
   `MAX_CHUNKS_PER_DOC` caps how many chunks we extract from per run.
   Top-N (by chunk_index) usually carries the document's defining
   entities.

4. Schema.org → our store, two layers:
     • Postgres `kg_nodes.entity_type` stores the raw Schema.org class
       name ("Person", "Corporation", "SoftwareApplication"). Column is
       a String — no enum constraint.
     • Neo4j labels get the same string. `graph_sync.upsert_entity`
       now accepts any identifier-shaped label after #47 loosened its
       whitelist to a regex.
     • Relations: same story — Schema.org predicate ("worksFor") is
       the `relation_type` in both Postgres and Neo4j.
     • `schema_uri` ("https://schema.org/Person") lives in node
       `properties` for future ontology-aware queries.

5. external_id as identity — slug-based, not Tom's UUID.
   Tom assigns a fresh UUID per `KnowledgeGraphConstructor` run, so the
   same entity across runs would produce different IDs — breaking
   cross-document dedup. We derive `external_id = ent:<schema_type>:<slug>`
   from the label so "Alice Chen" in doc A and doc B collapses to one
   node. Tom's UUID is kept in `properties.tom_entity_id` for
   within-run relation resolution.

6. Neo4j mirroring is still best-effort.
   `graph_sync.upsert_entity` / `upsert_relation` swallow + log their
   own errors. Postgres is the source of truth; Neo4j is rebuildable.

7. NonRetryableError is owned by kg_pipeline — not raised here.
   This module raises `ValueError` for things kg_pipeline.py treats as
   deterministic failures (missing KnowledgeItem). The orchestrator
   wraps the call.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.document import DocumentChunk
from app.models.kg import KGEdge, KGNode
from app.models.knowledge import KnowledgeItem
from app.services.graph_sync import upsert_entity, upsert_relation
from app.vendor.tom_kg import KnowledgeGraphConstructor, SchemaOrgEntity  # noqa: F401 — re-exported

log = logging.getLogger(__name__)

# Must mirror graph_sync._SAFE_LABEL_RE so what we store in Postgres
# matches what Neo4j accepts.  Predicates that don't match get
# normalised to "RELATED_TO" in both layers.
_SAFE_LABEL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


# ── Tuning knobs ──────────────────────────────────────────────────────

MAX_CHUNKS_PER_DOC = 20
"""Cap the number of chunks we extract from per document. Prevents a
single upload from burning through the entire LLM budget. The top-N
chunks (by chunk_index) usually carry the document's defining entities.
"""

CHUNK_CHAR_CAP = 2000
"""Hard cap on chunk content length passed to the LLM. Keeps per-call
latency bounded even if upstream chunking mis-sized something. Also
defends against an oversized chunk blowing Tom's prompt past the model
context window — the extractor embeds the full chunk text inline.
"""


# ── Extraction entry point ────────────────────────────────────────────

def extract_and_persist(db: Session, document_id: int) -> dict[str, Any]:
    """Run LLM extraction over the document's chunks and persist results.

    Called by the pipeline orchestrator after parse + index + vectorize
    have already run. Returns a summary dict for the task result.

    Idempotent: `KGNode.external_id` is unique, so re-running upserts
    the same nodes. New edges are deduped by the
    `(source_id, target_id, relation_type)` unique constraint.
    """
    item = db.get(KnowledgeItem, document_id)
    if item is None:
        raise ValueError(f"KnowledgeItem {document_id} not found")

    chunks = db.execute(
        select(DocumentChunk.chunk_index, DocumentChunk.content)
        .where(DocumentChunk.knowledge_item_id == document_id)
        .order_by(DocumentChunk.chunk_index)
        .limit(MAX_CHUNKS_PER_DOC)
    ).all()

    if not chunks:
        log.info("kg_extract doc=%s: no chunks, nothing to do", document_id)
        return {"document_id": document_id, "entities": 0, "relations": 0}

    # Document provenance node: the target of every MENTIONED_IN edge
    # and the anchor for Neo4j mirroring. "Document" is one of the six
    # core EntityType enum values, so it survives the whitelist.
    doc_eid = _doc_external_id(document_id)
    doc_node = _upsert_node(
        db,
        external_id=doc_eid,
        label=item.name,
        entity_type="Document",
        properties={"knowledge_item_id": document_id},
    )

    # ── Run Tom's extractor chunk by chunk ────────────────────────────
    # `KnowledgeGraphConstructor` maintains internal dedup across
    # add_text() calls, so the final `kg.entities` dict already has
    # cross-chunk coreference resolved. We track *which chunk each
    # entity first appeared in* by diffing the entity-key set before
    # and after each call — that drives the MENTIONED_IN provenance
    # edges. Matches the prior implementation's "last-seen chunk wins"
    # semantics for an entity that reappears in later chunks.
    kg = KnowledgeGraphConstructor(
        api_key=settings.LLM_API_KEY,
        model=settings.LLM_MODEL,
        base_url=settings.LLM_BASE_URL,
    )

    timestamp = item.created_at.isoformat() if item.created_at else None
    per_chunk_new_keys: list[tuple[int, set[str]]] = []

    for idx, content in chunks:
        before_keys = set(kg.entities.keys())
        try:
            # Tom's LLMClient is sync (openai.OpenAI().chat.completions.create),
            # Celery worker is also sync, so no asyncio juggling needed.
            kg.add_text((content or "")[:CHUNK_CHAR_CAP], timestamp=timestamp)
        except Exception as exc:  # noqa: BLE001
            # One bad chunk shouldn't fail the whole doc — log + skip,
            # preserving the pre-existing behaviour.
            log.warning("kg_extract tom add_text failed doc=%s chunk=%s: %s",
                        document_id, idx, exc)
            continue
        new_keys = set(kg.entities.keys()) - before_keys
        if new_keys:
            per_chunk_new_keys.append((idx, new_keys))

    kg.finalize()

    # ── Map Schema.org output into our stores ─────────────────────────

    # Upsert every entity to Postgres. Keep a within-run map from
    # Tom's internal UUID → our KGNode so we can resolve relation
    # subject/object UUIDs to actual rows below.
    tom_uuid_to_node: dict[str, KGNode] = {}
    entity_key_to_node: dict[str, KGNode] = {}
    total_entities = 0

    for key, entity in kg.entities.items():
        eid = _entity_external_id(entity.schema_type, entity.name)
        was_new, node = _upsert_node_with_flag(
            db,
            external_id=eid,
            label=entity.name,
            entity_type=entity.schema_type or "Entity",
            properties={
                # schema.org URI for future ontology-aware queries.
                "schema_uri": entity.schema_uri,
                # within-run UUID; only useful until the next pipeline run.
                "tom_entity_id": entity.entity_id,
                # any extra properties Tom's extractor surfaced
                # (jobTitle, description, …).
                **(entity.properties or {}),
            },
        )
        if was_new:
            total_entities += 1
        tom_uuid_to_node[entity.entity_id] = node
        entity_key_to_node[key] = node

    # MENTIONED_IN provenance edges. Tom's dict key is `schema_type:slug`,
    # matches our internal key — safe to lookup.
    total_relations = 0
    for idx, new_keys in per_chunk_new_keys:
        for key in new_keys:
            node = entity_key_to_node.get(key)
            if node is None:
                continue
            if _upsert_edge(
                db,
                source=node, target=doc_node,
                relation_type="MENTIONED_IN",
                properties={"chunk_index": idx},
            ):
                total_relations += 1

    # Inter-entity relations from Tom's extractor. Predicates are
    # raw Schema.org property names ("worksFor", "location", "knows").
    for rel in kg.relations:
        src = tom_uuid_to_node.get(rel.subject_id)
        dst = tom_uuid_to_node.get(rel.object_id)
        if src is None or dst is None or src.id == dst.id:
            continue
        predicate = (rel.predicate or "").strip() or "RELATED_TO"
        if not _SAFE_LABEL_RE.fullmatch(predicate):
            predicate = "RELATED_TO"
        if _upsert_edge(
            db,
            source=src, target=dst,
            relation_type=predicate,
            properties={"predicate_uri": rel.predicate_uri},
            confidence=rel.confidence,
        ):
            total_relations += 1

    db.flush()

    # Mirror to Neo4j — best effort. graph_sync swallows its own errors.
    _mirror_to_neo4j(db, document_id, doc_node)

    log.info(
        "kg_extract doc=%s entities=%d relations=%d chunks=%d",
        document_id, total_entities, total_relations, len(chunks),
    )
    return {
        "document_id": document_id,
        "entities": total_entities,
        "relations": total_relations,
        "chunks_processed": len(chunks),
    }


# ── external_id helpers ──────────────────────────────────────────────

def _doc_external_id(knowledge_item_id: int) -> str:
    return f"doc:{knowledge_item_id}"


# Normalize entity labels into a stable external_id. Casefold + collapse
# non-word chars to '-' so "Acme Inc." and "acme inc" dedupe to one node.
# Allow CJK characters through for Chinese entity labels — this is EKM's
# dominant content language.
_SLUG_NON_WORD = re.compile(r"[^\w\u4e00-\u9fff]+", re.UNICODE)


def _entity_external_id(entity_type: str, label: str) -> str:
    slug = _SLUG_NON_WORD.sub("-", (label or "").strip().casefold()).strip("-")
    # 120 chars keeps us well under the String(255) column cap even with
    # a long entity_type prefix.
    slug = slug[:120] or "unnamed"
    safe_type = (entity_type or "Entity").strip() or "Entity"
    return f"ent:{safe_type}:{slug}"


# ── Postgres upsert helpers ──────────────────────────────────────────

def _upsert_node(
    db: Session,
    *,
    external_id: str,
    label: str,
    entity_type: str,
    properties: dict[str, Any],
) -> KGNode:
    _, node = _upsert_node_with_flag(
        db,
        external_id=external_id, label=label,
        entity_type=entity_type, properties=properties,
    )
    return node


def _upsert_node_with_flag(
    db: Session,
    *,
    external_id: str,
    label: str,
    entity_type: str,
    properties: dict[str, Any],
) -> tuple[bool, KGNode]:
    """Upsert and report whether a new row was created.

    Returned flag drives the `entities` counter in the summary — we want
    to count genuinely new nodes, not re-visits across runs.
    """
    node = db.execute(
        select(KGNode).where(KGNode.external_id == external_id)
    ).scalar_one_or_none()
    if node is None:
        node = KGNode(
            external_id=external_id,
            label=label,
            entity_type=entity_type,
            properties=properties,
        )
        db.add(node)
        db.flush()
        return True, node

    # Keep the most recent label (humans edit casing) and merge props
    # so repeated mentions accumulate information rather than clobber.
    node.label = label
    merged = dict(node.properties or {})
    merged.update(properties)
    node.properties = merged
    # Upgrade entity_type only if the incoming type is more specific
    # than the stored one — prevents an "Entity" fallback from
    # overwriting a previously-stored "Person".
    if entity_type and entity_type != "Entity" and node.entity_type in (None, "", "Entity"):
        node.entity_type = entity_type
    return False, node


def _upsert_edge(
    db: Session,
    *,
    source: KGNode,
    target: KGNode,
    relation_type: str,
    properties: dict[str, Any],
    confidence: float | None = None,
) -> bool:
    """Idempotent edge insert. Returns True iff a new row was created.

    When ``confidence`` is provided and below the threshold
    (``KG_LOW_CONFIDENCE_THRESHOLD``), the edge is auto-flagged with
    ``needs_review=True``. MENTIONED_IN edges (provenance) are never
    flagged — they're structural, not extracted.
    """
    from app.core.config import settings

    needs_review = False
    if (
        confidence is not None
        and relation_type != "MENTIONED_IN"
        and confidence < settings.KG_LOW_CONFIDENCE_THRESHOLD
    ):
        needs_review = True

    existing = db.execute(
        select(KGEdge).where(
            KGEdge.source_id == source.id,
            KGEdge.target_id == target.id,
            KGEdge.relation_type == relation_type,
        )
    ).scalar_one_or_none()
    if existing is not None:
        merged = dict(existing.properties or {})
        merged.update(properties)
        existing.properties = merged
        if confidence is not None:
            existing.confidence = confidence
            existing.needs_review = needs_review
        return False
    db.add(KGEdge(
        source_id=source.id,
        target_id=target.id,
        relation_type=relation_type,
        properties=properties,
        confidence=confidence,
        needs_review=needs_review,
    ))
    db.flush()
    return True


# ── Neo4j mirror ─────────────────────────────────────────────────────

def _mirror_to_neo4j(
    db: Session,
    document_id: int,
    doc_node: KGNode,
) -> None:
    """Push this document's KG slice into Neo4j. Best-effort.

    Strategy: push the document node, every entity that has a
    MENTIONED_IN edge landing on it, and every inter-entity edge whose
    endpoints both MENTIONED_IN this document. That's a tight superset
    of "entities touched by this extraction run" without needing a
    separate tracking table.
    """
    import asyncio

    if not settings.NEO4J_URL:
        return

    # Entities mentioned in this document — one hop off the doc node.
    mention_edges = db.execute(
        select(KGEdge).where(
            KGEdge.target_id == doc_node.id,
            KGEdge.relation_type == "MENTIONED_IN",
        )
    ).scalars().all()
    mentioned_source_ids = [e.source_id for e in mention_edges]

    if not mentioned_source_ids:
        return

    mentioned_nodes = db.execute(
        select(KGNode).where(KGNode.id.in_(mentioned_source_ids))
    ).scalars().all()
    node_by_id: dict[int, KGNode] = {n.id: n for n in mentioned_nodes}

    # Inter-entity relations among the mentioned set. Avoid pushing
    # unrelated edges from other documents that happen to touch the
    # same nodes — this mirror is scoped to the current document's
    # slice.
    inter_edges: list[KGEdge] = []
    if mentioned_source_ids:
        inter_edges = db.execute(
            select(KGEdge).where(
                KGEdge.source_id.in_(mentioned_source_ids),
                KGEdge.target_id.in_(mentioned_source_ids),
            )
        ).scalars().all()

    async def _push() -> None:
        # Document first so MENTIONED_IN edges find their target.
        await upsert_entity(
            external_id=doc_node.external_id,
            label=doc_node.label,
            entity_type=doc_node.entity_type,
            properties=doc_node.properties,
        )
        # Mentioned entities.
        for node in mentioned_nodes:
            await upsert_entity(
                external_id=node.external_id,
                label=node.label,
                entity_type=node.entity_type,
                properties=node.properties,
            )
        # Provenance edges (entity → Document).
        for e in mention_edges:
            src = node_by_id.get(e.source_id)
            if src is None:
                continue
            await upsert_relation(
                source_external_id=src.external_id,
                target_external_id=doc_node.external_id,
                relation_type=e.relation_type,
                properties=e.properties,
            )
        # Inter-entity edges. Schema.org predicates land here.
        for e in inter_edges:
            src = node_by_id.get(e.source_id)
            dst = node_by_id.get(e.target_id)
            if src is None or dst is None:
                continue
            # Merge review metadata into Neo4j edge properties so graph
            # queries can filter on needs_review / confidence.
            edge_props = dict(e.properties or {})
            if e.confidence is not None:
                edge_props["confidence"] = e.confidence
            edge_props["needs_review"] = e.needs_review
            edge_props["edge_id"] = e.id
            await upsert_relation(
                source_external_id=src.external_id,
                target_external_id=dst.external_id,
                relation_type=e.relation_type,
                properties=edge_props,
            )

    try:
        asyncio.run(_push())
    except Exception as exc:  # noqa: BLE001
        log.warning("kg_extract: Neo4j mirror failed doc=%s: %s",
                    document_id, exc)


# ── Type-only re-exports so tests / tooling can reach the Schema.org types.
__all__ = [
    "extract_and_persist",
    "MAX_CHUNKS_PER_DOC",
    "CHUNK_CHAR_CAP",
    "SchemaOrgEntity",
]
