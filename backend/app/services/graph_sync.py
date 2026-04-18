"""Postgres → Neo4j sync helpers.

Writes go to Postgres first (single source of truth), then are mirrored to
Neo4j for traversal queries. Failure to mirror is logged but not raised —
graph features are best-effort; a broken sync shouldn't fail the request
that created the entity.

Functions here are kept small and idempotent so they can also run as a
Celery task for periodic full-reconciliation from Postgres.
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.graph import graph
from app.models.graph_vocab import ENTITY_TYPES, RELATION_TYPES

log = logging.getLogger(__name__)


async def upsert_entity(
    external_id: str,
    label: str,
    entity_type: str,
    properties: dict[str, Any] | None = None,
) -> None:
    """MERGE a node keyed on external_id. Label = :Entity:<Type>."""
    if entity_type not in ENTITY_TYPES:
        # Still store it, but tag as generic Entity so traversal still works.
        log.info("unknown entity_type %r; falling back to Entity", entity_type)
        entity_type = "Entity"

    # Neo4j multi-label: we always apply :Entity (for uniform queries) and
    # the specific type (for filtered queries). Properties are whatever
    # came from the extraction pipeline, with `label` as display name.
    cypher = (
        f"MERGE (n:Entity:{entity_type} {{external_id: $eid}}) "
        "SET n.label = $label, n += $props "
        "RETURN n.external_id AS id"
    )
    try:
        await graph.run(cypher, {
            "eid": external_id,
            "label": label,
            "props": properties or {},
        })
    except Exception as exc:  # noqa: BLE001
        log.warning("upsert_entity failed for %s: %s", external_id, exc)


async def upsert_relation(
    source_external_id: str,
    target_external_id: str,
    relation_type: str,
    properties: dict[str, Any] | None = None,
) -> None:
    """MERGE a relationship between two entities. Safe to re-run."""
    if relation_type not in RELATION_TYPES:
        log.info("unknown relation_type %r; falling back to RELATED_TO", relation_type)
        relation_type = "RELATED_TO"

    # Relationship types can't be parameterised — they're interpolated after
    # validation against our vocabulary above, so no injection surface.
    cypher = (
        "MATCH (a:Entity {external_id: $src}), (b:Entity {external_id: $dst}) "
        f"MERGE (a)-[r:{relation_type}]->(b) "
        "SET r += $props "
        "RETURN type(r) AS rel"
    )
    try:
        await graph.run(cypher, {
            "src": source_external_id,
            "dst": target_external_id,
            "props": properties or {},
        })
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "upsert_relation failed %s-[%s]->%s: %s",
            source_external_id, relation_type, target_external_id, exc,
        )


async def neighbors(
    external_id: str,
    *,
    depth: int = 1,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return nodes within `depth` hops of the given entity.

    depth is clamped [1, 3] — deeper traversals are expensive and better
    served by a custom Cypher query rather than a generic helper.
    """
    depth = max(1, min(depth, 3))
    cypher = (
        "MATCH (n:Entity {external_id: $eid})-[*1.." + str(depth) + "]-(m:Entity) "
        "RETURN DISTINCT m.external_id AS external_id, m.label AS label, labels(m) AS labels "
        "LIMIT $limit"
    )
    try:
        return await graph.run(cypher, {"eid": external_id, "limit": limit})
    except Exception as exc:  # noqa: BLE001
        log.warning("neighbors query failed for %s: %s", external_id, exc)
        return []
