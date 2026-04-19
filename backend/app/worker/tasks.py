"""Celery task registry.

Stubs land here first; real implementations are filled in by:
    #15 parse_document     — Tika pipeline
    #16 index_to_es        — Elasticsearch ingest
    #22 vectorize_chunks   — Qdrant embeddings

Keeping them co-located means one `celery -A app.worker.celery_app` discovers
every task without chasing decorators across the codebase.
"""
from __future__ import annotations

import logging
from typing import Any

from app.worker.celery_app import celery_app


log = logging.getLogger(__name__)


@celery_app.task(name="ekm.health.ping", bind=True)
def ping(self) -> dict[str, Any]:
    """Liveness check. Useful to confirm broker + worker are wired up."""
    return {"status": "ok", "task_id": self.request.id}


@celery_app.task(name="ekm.docs.parse", bind=True, max_retries=3, default_retry_delay=30)
def parse_document(self, document_id: int) -> dict[str, Any]:
    """Extract text + metadata via Tika, persist chunks, then chain
    index_to_es + vectorize_chunks so the downstream stores stay in sync.
    """
    from app.services.document_parse import parse_and_persist

    result = parse_and_persist(int(document_id))

    # Fan out: ES indexing + Qdrant embedding run independently.
    index_to_es.delay(int(document_id))
    vectorize_chunks.delay(int(document_id))

    return {"document_id": document_id, "status": "parsed", **result}


@celery_app.task(name="ekm.docs.index", bind=True, max_retries=3, default_retry_delay=30)
def index_to_es(self, document_id: int) -> dict[str, Any]:
    """Upsert KnowledgeItem + its DocumentChunks into Elasticsearch.

    Runs after parse_document. Idempotent: bulk upsert overwrites prior docs.
    """
    from sqlalchemy import select
    from app.services.document_parse import SyncSession
    from app.services.es_sync import bulk_index_chunks, index_item
    from app.models.document import DocumentChunk
    from app.models.knowledge import KnowledgeItem, TagAssignment, Tag

    document_id = int(document_id)
    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is None:
            return {"document_id": document_id, "status": "not_found"}

        chunks = db.execute(
            select(DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        ).all()

        tag_names = db.execute(
            select(Tag.name)
            .join(TagAssignment, TagAssignment.tag_id == Tag.id)
            .where(TagAssignment.knowledge_item_id == document_id)
        ).scalars().all()

        indexed = bulk_index_chunks(document_id, [(idx, content) for idx, content in chunks])

        index_item(
            document_id,
            {
                "id": document_id,
                "name": item.name,
                "description": item.description,
                "file_type": item.file_type.value if hasattr(item.file_type, "value") else str(item.file_type),
                "mime_type": item.mime_type,
                "uploader_id": item.uploader_id,
                "category_id": item.category_id,
                "tags": list(tag_names),
                "created_at": item.created_at.isoformat() if item.created_at else None,
            },
        )

    log.info("indexed doc=%s chunks=%d", document_id, indexed)
    return {"document_id": document_id, "indexed_chunks": indexed, "status": "indexed"}


@celery_app.task(name="ekm.sharing.purge_expired", bind=True)
def purge_expired_shares(self) -> dict[str, Any]:
    """Hard-delete sharing_records whose deleted_at exceeds the retention
    window. Runs daily via beat; safe to invoke manually.

    The service layer's SharingError(\"RESTORE_WINDOW_EXPIRED\") already
    prevents users from touching these rows, so we can remove them without
    coordinating with live requests.
    """
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import delete as sa_delete
    from app.services.document_parse import SyncSession
    from app.services.sharing import RETENTION_DAYS
    from app.models.sharing import SharingRecord

    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    with SyncSession() as db:
        result = db.execute(
            sa_delete(SharingRecord).where(
                SharingRecord.deleted_at.is_not(None),
                SharingRecord.deleted_at < cutoff,
            )
        )
        purged = result.rowcount or 0
        db.commit()

    log.info("purge_expired_shares cutoff=%s purged=%d", cutoff.isoformat(), purged)
    return {"cutoff": cutoff.isoformat(), "purged": purged, "status": "ok"}


@celery_app.task(name="ekm.archive.tick", bind=True)
def archive_tick(self) -> dict[str, Any]:
    """Daily sweep: send pre-archive reminders + auto-archive stale items.

    Two-phase flow:
      1. DB phase — flip is_archived / stamp archive_reminder_sent_at,
         insert Notification rows, collect a pending-email list. Commit.
      2. Mail phase — AFTER commit succeeds, drain the pending-email
         list. If commit rolls back, no emails fire → no false "your
         doc was archived" nudges for a DB state that doesn't exist.
         Mailer is already best-effort (swallows failures), so a mid-
         drain crash just drops the tail, never corrupts DB state.

    All in-app notifications are DB-only: this runs in the Celery worker
    process, which has no WS ConnectionManager. Users receive the
    backlog via #27's WS-connect flush.
    """
    from datetime import datetime, timedelta, timezone

    from app.core.config import settings
    from app.models.notification import Notification, NotificationType
    from app.models.user import User
    from app.services.archive import (
        fetch_candidates, load_active_rules, resolve_effective_rule,
    )
    from app.services.document_parse import SyncSession
    from app.services.mailer import send_sync as mail_send

    now = datetime.now(timezone.utc)
    reminder_window = timedelta(days=settings.ARCHIVE_REMINDER_DAYS_BEFORE)

    reminders = 0
    archived = 0
    pending_mails: list[dict[str, str]] = []  # drained AFTER commit

    with SyncSession() as db:
        rules = load_active_rules(db)
        if not rules:
            return {"status": "no_rules", "reminders": 0, "archived": 0}

        items = fetch_candidates(db)
        for item in items:
            eff = resolve_effective_rule(db, item, rules)
            if eff is None:
                continue

            threshold_at = item.updated_at + timedelta(days=eff.inactive_days)

            if now >= threshold_at:
                # Phase 2a (DB): past threshold — auto-archive.
                item.is_archived = True
                item.archived_at = now
                db.add(Notification(
                    user_id=item.uploader_id,
                    type=NotificationType.AUTO_ARCHIVED,
                    title=f"已自动归档: {item.name}",
                    payload={
                        "knowledge_id": item.id,
                        "name": item.name,
                        "rule_id": eff.rule_id,
                        "rule_name": eff.rule_name,
                        "inactive_days": eff.inactive_days,
                    },
                ))
                archived += 1
                uploader = db.get(User, item.uploader_id)
                if uploader and uploader.email:
                    pending_mails.append({
                        "to": uploader.email,
                        "subject": f"[EKM] 文档已自动归档: {item.name}",
                        "body": (
                            f"您的文档「{item.name}」已根据规则「{eff.rule_name}」"
                            f"自动归档（超过 {eff.inactive_days} 天未更新）。\n"
                            f"如需恢复，请访问: {settings.PUBLIC_BASE_URL}/knowledge/{item.id}"
                        ),
                    })
                continue

            # Phase 1 (DB): inside reminder window?
            window_start = threshold_at - reminder_window
            if now < window_start:
                continue  # too early — no action

            # Only send one reminder per window.
            if (
                item.archive_reminder_sent_at is not None
                and item.archive_reminder_sent_at >= window_start
            ):
                continue

            days_left = max(0, (threshold_at - now).days)
            db.add(Notification(
                user_id=item.uploader_id,
                type=NotificationType.ARCHIVE_REMINDER,
                title=f"即将归档: {item.name}（{days_left} 天后）",
                payload={
                    "knowledge_id": item.id,
                    "name": item.name,
                    "days_left": days_left,
                    "threshold_at": threshold_at.isoformat(),
                    "rule_id": eff.rule_id,
                    "rule_name": eff.rule_name,
                },
            ))
            item.archive_reminder_sent_at = now
            reminders += 1

            uploader = db.get(User, item.uploader_id)
            if uploader and uploader.email:
                pending_mails.append({
                    "to": uploader.email,
                    "subject": f"[EKM] 文档 {days_left} 天后将自动归档: {item.name}",
                    "body": (
                        f"您的文档「{item.name}」将在 {days_left} 天后根据规则"
                        f"「{eff.rule_name}」自动归档。\n"
                        f"要保留该文档，请在此日期前更新或查看:\n"
                        f"{settings.PUBLIC_BASE_URL}/knowledge/{item.id}"
                    ),
                })

        # Atomic DB boundary. If this raises, pending_mails is discarded
        # and no false notifications go out — that's the whole point.
        db.commit()

    # Phase 2b (mail): DB is durable. Now fire emails. mailer.send_sync
    # is already best-effort (logs + returns False on failure), so we
    # don't wrap it here.
    for m in pending_mails:
        mail_send(to=m["to"], subject=m["subject"], body=m["body"])

    log.info(
        "archive tick: reminders=%d archived=%d mails_attempted=%d",
        reminders, archived, len(pending_mails),
    )
    return {
        "status": "ok",
        "reminders": reminders,
        "archived": archived,
        "mails_attempted": len(pending_mails),
    }


@celery_app.task(
    name="ekm.kg.pipeline",
    bind=True,
    # Extract stage can be slow (N LLM calls per doc) — spread retries
    # so a transient Neo4j blip or LLM 429 gets room to clear.
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
)
def kg_pipeline(self, document_id: int) -> dict[str, Any]:
    """End-to-end KG extraction pipeline for one document (US-048).

    Fires automatically after a successful upload (see routers/files).
    Walks four stages (parse → index → vectorize → extract) and writes
    per-stage status back to `knowledge_items.kg_status`/`kg_stage`/
    `kg_error` so the frontend can poll and render "处理中 / 已完成 /
    失败（在 extract 阶段）".

    Each stage is idempotent; a Celery-level retry safely re-runs from
    the top. The retry ceiling is 3 before terminal FAILED lands — good
    enough for transient infra flakes without burning through the LLM
    budget on a poison document.
    """
    from app.services.kg_pipeline import run_pipeline
    return run_pipeline(int(document_id), task_id=self.request.id)


@celery_app.task(name="ekm.docs.vectorize", bind=True, max_retries=3, default_retry_delay=60)
def vectorize_chunks(self, document_id: int) -> dict[str, Any]:
    """Embed each DocumentChunk + upsert to Qdrant. Idempotent on re-run."""
    from sqlalchemy import select, update
    from app.services.document_parse import SyncSession
    from app.services.embeddings import embedder
    from app.services.qdrant_client import ensure_collection, upsert_chunks
    from app.models.document import DocumentChunk

    document_id = int(document_id)
    ensure_collection()

    with SyncSession() as db:
        rows = db.execute(
            select(DocumentChunk.id, DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        ).all()

        if not rows:
            return {"document_id": document_id, "status": "no_chunks"}

        vectors = embedder.embed([r.content for r in rows])
        triples = [(r.chunk_index, r.content, vec) for r, vec in zip(rows, vectors)]
        count = upsert_chunks(document_id, triples)

        # Back-link the Qdrant point id onto each chunk for debuggability.
        for r in rows:
            db.execute(
                update(DocumentChunk)
                .where(DocumentChunk.id == r.id)
                .values(vector_id=str(document_id * 1_000_000 + r.chunk_index))
            )
        db.commit()

    log.info("vectorized doc=%s count=%d", document_id, count)
    return {"document_id": document_id, "vectorized": count, "status": "vectorized"}
