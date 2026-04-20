"""KG quality review service — Issue #54.

Pure async functions for the review-queue and quality-stats endpoints.
All DB operations use AsyncSession (FastAPI path). Neo4j sync is
best-effort.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Select, and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.kg import KGEdge, KGNode

log = logging.getLogger(__name__)


# ── Review queue ─────────────────────────────────────────────────────


async def list_review_queue(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    """Return edges that need human review, paginated.

    Sorted by confidence ASC (lowest first). Excludes soft-deleted edges.
    """
    base_filter = and_(
        KGEdge.needs_review.is_(True),
        KGEdge.deleted_at.is_(None),
    )

    total = (await db.execute(
        select(func.count()).select_from(KGEdge).where(base_filter)
    )).scalar_one()

    offset = (page - 1) * page_size
    rows = (await db.execute(
        select(KGEdge)
        .where(base_filter)
        .options(selectinload(KGEdge.source), selectinload(KGEdge.target))
        .order_by(KGEdge.confidence.asc().nulls_last(), KGEdge.id.asc())
        .offset(offset)
        .limit(page_size)
    )).scalars().all()

    items = []
    for edge in rows:
        # Find source document via MENTIONED_IN edges from source entity.
        source_doc = await _find_source_document(db, edge.source_id)
        items.append({
            "edge_id": edge.id,
            "source": {
                "entity_id": edge.source.external_id if edge.source else None,
                "name": edge.source.label if edge.source else None,
                "schema_type": edge.source.entity_type if edge.source else None,
            },
            "target": {
                "entity_id": edge.target.external_id if edge.target else None,
                "name": edge.target.label if edge.target else None,
                "schema_type": edge.target.entity_type if edge.target else None,
            },
            "predicate": edge.relation_type,
            "confidence": edge.confidence,
            "source_doc_id": source_doc,
            "created_at": edge.created_at.isoformat() if edge.created_at else None,
        })

    return {"total": total, "items": items}


async def _find_source_document(db: AsyncSession, entity_node_id: int) -> str | None:
    """Find the document external_id that mentions this entity (first match)."""
    row = (await db.execute(
        select(KGNode.external_id)
        .join(KGEdge, KGEdge.target_id == KGNode.id)
        .where(
            KGEdge.source_id == entity_node_id,
            KGEdge.relation_type == "MENTIONED_IN",
        )
        .limit(1)
    )).scalar_one_or_none()
    return row


# ── Approve / Reject ─────────────────────────────────────────────────


class ReviewError(Exception):
    def __init__(self, message: str, code: str = "review_error"):
        self.message = message
        self.code = code
        super().__init__(message)


async def approve_edge(db: AsyncSession, edge_id: int, reviewer_id: int) -> KGEdge:
    """Approve a low-confidence edge. Idempotent."""
    edge = await _get_edge_or_raise(db, edge_id, for_update=True)

    edge.needs_review = False
    edge.reviewed_by_id = reviewer_id
    edge.reviewed_at = datetime.now(timezone.utc)
    await db.flush()

    return edge


async def reject_edge(db: AsyncSession, edge_id: int, reviewer_id: int) -> KGEdge:
    """Soft-delete a rejected edge. Idempotent."""
    edge = await _get_edge_or_raise(db, edge_id, for_update=True)

    edge.deleted_at = datetime.now(timezone.utc)
    edge.reviewed_by_id = reviewer_id
    edge.reviewed_at = datetime.now(timezone.utc)
    edge.needs_review = False
    await db.flush()

    return edge


async def _get_edge_or_raise(db: AsyncSession, edge_id: int, *, for_update: bool = False) -> KGEdge:
    edge = await db.get(KGEdge, edge_id, with_for_update=for_update)
    if edge is None:
        raise ReviewError("Edge not found", code="not_found")
    if edge.deleted_at is not None:
        raise ReviewError("Edge already deleted", code="already_deleted")
    return edge


# ── Quality stats ────────────────────────────────────────────────────


async def quality_stats(db: AsyncSession) -> dict[str, Any]:
    """Aggregate KG quality metrics."""
    # Exclude MENTIONED_IN (structural) from stats — only inter-entity edges.
    base = KGEdge.relation_type != "MENTIONED_IN"

    total = (await db.execute(
        select(func.count()).select_from(KGEdge).where(base, KGEdge.deleted_at.is_(None))
    )).scalar_one()

    pending = (await db.execute(
        select(func.count()).select_from(KGEdge).where(
            base, KGEdge.needs_review.is_(True), KGEdge.deleted_at.is_(None),
        )
    )).scalar_one()

    approved = (await db.execute(
        select(func.count()).select_from(KGEdge).where(
            base,
            KGEdge.needs_review.is_(False),
            KGEdge.reviewed_by_id.isnot(None),
            KGEdge.deleted_at.is_(None),
        )
    )).scalar_one()

    rejected = (await db.execute(
        select(func.count()).select_from(KGEdge).where(
            base, KGEdge.deleted_at.isnot(None),
        )
    )).scalar_one()

    avg_conf = (await db.execute(
        select(func.avg(KGEdge.confidence)).where(
            base, KGEdge.deleted_at.is_(None), KGEdge.confidence.isnot(None),
        )
    )).scalar_one()

    total_entities = (await db.execute(
        select(func.count()).select_from(KGNode)
    )).scalar_one()

    # Low confidence ratio — only among edges that have a confidence value.
    from app.core.config import settings
    threshold = settings.KG_LOW_CONFIDENCE_THRESHOLD

    edges_with_conf = (await db.execute(
        select(func.count()).select_from(KGEdge).where(
            base, KGEdge.deleted_at.is_(None), KGEdge.confidence.isnot(None),
        )
    )).scalar_one()

    low_conf_count = (await db.execute(
        select(func.count()).select_from(KGEdge).where(
            base,
            KGEdge.deleted_at.is_(None),
            KGEdge.confidence.isnot(None),
            KGEdge.confidence < threshold,
        )
    )).scalar_one()

    return {
        "total_entities": total_entities,
        "total_relations": total,
        "pending_review": pending,
        "approved": approved,
        "rejected": rejected,
        "avg_confidence": round(avg_conf, 4) if avg_conf is not None else None,
        "low_confidence_ratio": round(low_conf_count / edges_with_conf, 4) if edges_with_conf > 0 else 0.0,
    }


# ── Neo4j helpers (best-effort) ──────────────────────────────────────


async def sync_edge_review_neo4j(edge_id: int, *, needs_review: bool) -> None:
    """Update needs_review on a Neo4j relationship by edge_id."""
    try:
        from app.core.config import settings
        if not settings.NEO4J_URL:
            return
        from app.core.graph import graph
        await graph.run(
            "MATCH ()-[r]->() WHERE r.edge_id = $eid "
            "SET r.needs_review = $nr",
            {"eid": edge_id, "nr": needs_review},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Neo4j review sync failed edge=%s: %s", edge_id, exc)


async def delete_edge_neo4j(edge_id: int) -> None:
    """Delete a relationship from Neo4j by edge_id."""
    try:
        from app.core.config import settings
        if not settings.NEO4J_URL:
            return
        from app.core.graph import graph
        await graph.run(
            "MATCH ()-[r]->() WHERE r.edge_id = $eid DELETE r",
            {"eid": edge_id},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Neo4j edge delete failed edge=%s: %s", edge_id, exc)
