"""LLM-based knowledge-graph extraction.

Turns parsed chunks into entities + relations, writes them to Postgres
(`kg_nodes` / `kg_edges` — the canonical store), then mirrors to Neo4j
for traversal. Also creates a provenance edge:

    (entity) -[:MENTIONED_IN]-> (:Document {id: knowledge_item_id})

so any entity can be traced back to the documents that mention it.

Design choices:

1. Chunk-level LLM calls.
   One completion per chunk, not one giant prompt for the whole doc.
   Smaller prompts = higher accuracy, faster retries, easier caching.
   The LLM sees 1–2k chars at a time, which fits the controlled
   vocabulary nicely.

2. Bounded cost.
   `MAX_CHUNKS_PER_DOC` caps how many chunks we extract from per run.
   A 500-chunk document would otherwise eat the whole extract budget.
   After that, chunks near the top are most likely to contain the
   defining entities (title, headings, summary) — good-enough heuristic
   for v1.

3. Controlled vocabulary fallback.
   The LLM sometimes invents entity / relation types. We validate
   against `EntityType` / `RelationType` — unknown types map to the
   fallback (`Entity`, `RELATED_TO`). Same approach as
   `services/graph_sync.py`; keeps the data useful instead of lost.

4. external_id as identity.
   We key entities by a normalized name (`entity_type:slug`). Same
   person mentioned in two docs dedups to one node; the `MENTIONED_IN`
   edge carries the provenance. This matches how `graph_sync` already
   addresses nodes.

5. Neo4j mirroring is best-effort.
   `graph_sync.upsert_entity` / `upsert_relation` already swallow
   errors + log. If Neo4j is down, Postgres is still the source of
   truth — a reconciliation task can rebuild the graph later.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.document import DocumentChunk
from app.models.graph_vocab import ENTITY_TYPES, RELATION_TYPES, EntityType, RelationType
from app.models.kg import KGEdge, KGNode
from app.models.knowledge import KnowledgeItem
from app.services.graph_sync import upsert_entity, upsert_relation
from app.services.llm_client import llm

log = logging.getLogger(__name__)


# ── Tuning knobs ──────────────────────────────────────────────────────

MAX_CHUNKS_PER_DOC = 20
"""Cap the number of chunks we extract from per document. Prevents a
single upload from burning through the entire LLM budget. The top-N
chunks (by chunk_index) usually carry the document's defining entities.
"""

CHUNK_CHAR_CAP = 2000
"""Hard cap on chunk content length passed to the LLM. Keeps per-call
latency bounded even if upstream chunking mis-sized something."""


# ── Prompts ───────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """你是知识图谱抽取引擎。从给定文本中抽取实体和关系。

实体类型（entity_type）必须是下列之一，不符合的实体请归入 Entity:
- Concept: 抽象概念、主题
- Person: 具体人物
- Organization: 机构、组织、公司
- Location: 地理位置
- Document: 文档、文件、报告
- Entity: 其它通用实体

关系类型（relation_type）必须是下列之一，不符合的关系请归入 RELATED_TO:
- PART_OF: A 是 B 的一部分
- INSTANCE_OF: A 是 B 的实例
- REFERENCES: A 引用了 B
- MENTIONED_IN: A 在 B 中被提及
- RELATED_TO: 通用相关

严格输出 JSON，格式：
{
  "entities": [{"label": "实体名", "entity_type": "Person"}],
  "relations": [{"source": "实体A", "target": "实体B", "relation_type": "RELATED_TO"}]
}

不要输出任何解释性文字。实体 label 必须在 relations 的 source/target 中能找到对应，否则丢弃该关系。"""


def _build_user_prompt(chunk_text: str) -> str:
    # Keep the user turn minimal — the instructions live in system.
    return f"文本:\n\"\"\"\n{chunk_text[:CHUNK_CHAR_CAP]}\n\"\"\""


# ── Extraction ────────────────────────────────────────────────────────

def extract_and_persist(db: Session, document_id: int) -> dict[str, Any]:
    """Run LLM extraction over the document's chunks and persist results.

    Called by the pipeline orchestrator after parse + index + vectorize
    have already run. Returns a summary dict for the task result.

    Idempotent: `KGNode.external_id` is unique, so re-running upserts
    the same nodes. New `MENTIONED_IN` edges that already exist are
    caught by the `(source_id, target_id, relation_type)` unique
    constraint on `kg_edges`.
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

    # Ensure the Document node exists up front — used as the provenance
    # target for every MENTIONED_IN edge below. external_id namespacing
    # keeps Document ids clearly distinct from extracted entities.
    doc_eid = _doc_external_id(document_id)
    doc_node = _upsert_node(
        db,
        external_id=doc_eid,
        label=item.name,
        entity_type=EntityType.DOCUMENT.value,
        properties={"knowledge_item_id": document_id},
    )

    total_entities = 0
    total_relations = 0
    seen_nodes: dict[str, KGNode] = {doc_eid: doc_node}

    for idx, content in chunks:
        try:
            payload = _call_llm(content)
        except Exception as exc:  # noqa: BLE001
            # One bad chunk shouldn't fail the whole doc. Log and skip.
            log.warning("kg_extract LLM failed doc=%s chunk=%s: %s",
                        document_id, idx, exc)
            continue

        entities = payload.get("entities") or []
        relations = payload.get("relations") or []

        # First pass: upsert all entities mentioned in this chunk,
        # indexed by their LLM-provided label for relation lookup.
        label_to_node: dict[str, KGNode] = {}
        for ent in entities:
            label = (ent.get("label") or "").strip()
            etype = (ent.get("entity_type") or "").strip()
            if not label:
                continue
            # Fallback to generic Entity if the LLM went off-vocab.
            if etype not in ENTITY_TYPES:
                etype = EntityType.ENTITY.value

            eid = _entity_external_id(etype, label)
            node = seen_nodes.get(eid)
            if node is None:
                node = _upsert_node(
                    db, external_id=eid, label=label,
                    entity_type=etype, properties={},
                )
                seen_nodes[eid] = node
                total_entities += 1
            label_to_node[label] = node

            # Provenance: entity mentioned in this document.
            if _upsert_edge(
                db,
                source=node, target=doc_node,
                relation_type=RelationType.MENTIONED_IN.value,
                properties={"chunk_index": idx},
            ):
                total_relations += 1

        # Second pass: cross-entity relations within the chunk.
        for rel in relations:
            src_label = (rel.get("source") or "").strip()
            dst_label = (rel.get("target") or "").strip()
            rtype = (rel.get("relation_type") or "").strip()
            src = label_to_node.get(src_label)
            dst = label_to_node.get(dst_label)
            if src is None or dst is None or src.id == dst.id:
                continue
            if rtype not in RELATION_TYPES:
                rtype = RelationType.RELATED_TO.value
            if _upsert_edge(
                db, source=src, target=dst,
                relation_type=rtype,
                properties={"chunk_index": idx},
            ):
                total_relations += 1

    db.flush()

    # Mirror to Neo4j. Best-effort — graph_sync already swallows errors.
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


# ── Helpers ───────────────────────────────────────────────────────────

def _call_llm(chunk_content: str) -> dict[str, Any]:
    """Invoke the LLM and parse its JSON output. Raises on malformed JSON."""
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_prompt(chunk_content)},
    ]
    # llm.complete is async; Celery worker is sync — run it in a fresh
    # event loop. Same pattern as document_parse.py's _run().
    text = asyncio.run(llm.complete(
        messages,
        # Small cap — we only need entities + relations, not prose.
        max_tokens=1024,
    ))
    return _parse_json_block(text)


# Models occasionally wrap JSON in ```json ... ``` fences or prepend a
# sentence. Strip both patterns before json.loads.
_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _parse_json_block(text: str) -> dict[str, Any]:
    text = text.strip()
    m = _FENCE_RE.search(text)
    if m:
        text = m.group(1)
    # Grab the outermost {...} — the LLM sometimes adds a trailing note.
    first = text.find("{")
    last = text.rfind("}")
    if first < 0 or last < 0 or last < first:
        raise ValueError(f"no JSON object found in LLM output: {text[:200]}")
    return json.loads(text[first : last + 1])


def _doc_external_id(knowledge_item_id: int) -> str:
    return f"doc:{knowledge_item_id}"


# Normalize entity labels into a stable external_id. Casefold + collapse
# non-word chars to '-' so "Acme Inc." and "acme inc" dedupe to one node.
_SLUG_NON_WORD = re.compile(r"[^\w\u4e00-\u9fff]+", re.UNICODE)


def _entity_external_id(entity_type: str, label: str) -> str:
    slug = _SLUG_NON_WORD.sub("-", label.strip().casefold()).strip("-")
    # 120 chars is plenty and keeps us well under the 255 column cap.
    slug = slug[:120] or "unnamed"
    return f"ent:{entity_type}:{slug}"


def _upsert_node(
    db: Session,
    *,
    external_id: str,
    label: str,
    entity_type: str,
    properties: dict[str, Any],
) -> KGNode:
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
    else:
        # Keep the most recent label (humans edit casing) and merge props.
        node.label = label
        merged = dict(node.properties or {})
        merged.update(properties)
        node.properties = merged
    return node


def _upsert_edge(
    db: Session,
    *,
    source: KGNode,
    target: KGNode,
    relation_type: str,
    properties: dict[str, Any],
) -> bool:
    """Idempotent edge insert. Returns True if a new edge was created."""
    existing = db.execute(
        select(KGEdge).where(
            KGEdge.source_id == source.id,
            KGEdge.target_id == target.id,
            KGEdge.relation_type == relation_type,
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Update properties so last-seen chunk info wins — cheap and lets
        # ops trace back to a specific chunk without maintaining a
        # separate occurrences table.
        merged = dict(existing.properties or {})
        merged.update(properties)
        existing.properties = merged
        return False
    db.add(KGEdge(
        source_id=source.id,
        target_id=target.id,
        relation_type=relation_type,
        properties=properties,
    ))
    db.flush()
    return True


def _mirror_to_neo4j(
    db: Session, document_id: int, doc_node: KGNode,
) -> None:
    """Push this document's KG slice into Neo4j. Best-effort."""
    # Neo4j's bolt driver is async — wrap in asyncio.run for the sync
    # worker context. Any failure here is logged by graph_sync and
    # swallowed; Neo4j is a read-model, not the source of truth.
    if not settings.NEO4J_URL:
        return

    # Pull the entities + edges we touched in this run. A follow-up
    # reconciliation task can do full-doc re-syncs.
    nodes = db.execute(
        select(KGNode).where(KGNode.external_id == doc_node.external_id)
    ).scalars().all()
    edges = db.execute(
        select(KGEdge).where(KGEdge.target_id == doc_node.id)
    ).scalars().all()

    async def _push() -> None:
        await upsert_entity(
            external_id=doc_node.external_id,
            label=doc_node.label,
            entity_type=doc_node.entity_type,
            properties=doc_node.properties,
        )
        # For each MENTIONED_IN edge landing on this doc, push its
        # source entity and the edge itself.
        for e in edges:
            src = db.get(KGNode, e.source_id)
            if src is None:
                continue
            await upsert_entity(
                external_id=src.external_id,
                label=src.label,
                entity_type=src.entity_type,
                properties=src.properties,
            )
            await upsert_relation(
                source_external_id=src.external_id,
                target_external_id=doc_node.external_id,
                relation_type=e.relation_type,
                properties=e.properties,
            )

    try:
        asyncio.run(_push())
    except Exception as exc:  # noqa: BLE001
        log.warning("kg_extract: Neo4j mirror failed doc=%s: %s",
                    document_id, exc)
