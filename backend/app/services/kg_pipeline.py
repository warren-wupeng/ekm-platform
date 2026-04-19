"""End-to-end KG extraction pipeline orchestrator (US-048).

Runs four stages sequentially for a single document:

    parse      →  Tika extraction + chunking  (services.document_parse)
    index      →  Elasticsearch bulk index    (services.es_sync)
    vectorize  →  embedding + Qdrant upsert   (services.embeddings + qdrant_client)
    extract    →  LLM NER + Postgres kg_*     (services.kg_extract)
                  + mirror to Neo4j           (services.graph_sync)

Design choices:

1. One task, not four chained.
   A single Celery task (`ekm.kg.pipeline`) owns the whole run. It's
   simpler to track, observe, and retry than a chain of four Celery
   tasks — which would scatter status across four AsyncResult keys,
   require per-link idempotency, and make "what stage failed?" a
   multi-log query. Each stage is already idempotent via its own
   contract (parse: delete+insert chunks; index/vectorize: upsert;
   extract: external_id dedup). So a full retry re-runs everything
   safely.

2. Stage-aware state tracking.
   Before each stage we stamp `knowledge_items.kg_stage` and move
   status to RUNNING. If a stage throws, `kg_error` captures the
   message, `kg_stage` stays on the offending stage, and we set
   FAILED. Frontend sees `stage="extract"` + `status="failed"` and
   knows to offer a retry.

3. Skip non-parseable types.
   Images, archives, audio/video skip straight to SKIPPED with
   `kg_stage="parse"` (attempted but bypassed). The pipeline isn't
   "broken" for a PNG — it just doesn't apply.

4. Commit boundaries.
   We commit after each successful stage so that partial progress
   is durable if a later stage fails — you can rerun just the
   extract stage manually once that's wired up. The status-update
   commits are separate from the stage's own data commits, so a
   slow status write can't roll back chunks that are already ingested.

5. Swallow-or-propagate, per stage.
   parse / extract raise on real failure → we mark FAILED and
   re-raise so Celery's retry policy kicks in. index and vectorize
   raise too — ES and Qdrant being down should fail the pipeline
   (retry), not silently drop the document from search / vector
   indexes.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.document import DocumentChunk
from app.models.knowledge import FileType, KGPipelineStatus, KnowledgeItem, Tag, TagAssignment
from app.services.document_parse import SyncSession, parse_and_persist

log = logging.getLogger(__name__)


class NonRetryableError(Exception):
    """Deterministic pipeline failure — retrying won't help.

    Examples: KnowledgeItem missing from DB, item has no file_path,
    file_type is outside the supported set. These won't resolve on
    their own; a retry just burns the autoretry budget and delays the
    terminal FAILED state the frontend is polling for.

    Sibling of Celery's `Reject`/`Ignore`, but keeps the typing at the
    pipeline layer so tests don't need a Celery context.
    """


# File types we don't run the pipeline on. Anything outside DOCUMENT
# has no text Tika can meaningfully extract for NER / embedding.
_PIPELINE_TYPES = {FileType.DOCUMENT}


# ── Public entrypoint ────────────────────────────────────────────────

def run_pipeline(document_id: int, *, task_id: str | None = None) -> dict[str, Any]:
    """Execute the full KG pipeline for one document.

    Called by `ekm.kg.pipeline` Celery task. Returns a summary dict for
    AsyncResult. Raises on terminal stage failure so Celery can retry.
    """
    # First pass: early-out for file types we don't process. Keep this
    # in its own short session so we release the DB connection before
    # the long-running stages start.
    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is None:
            # Deterministic — row was deleted between upload ack and task pick-up.
            raise NonRetryableError(f"KnowledgeItem {document_id} not found")
        if item.file_type not in _PIPELINE_TYPES:
            _mark(
                db, item,
                status=KGPipelineStatus.SKIPPED,
                stage="parse",
                error=None,
                task_id=task_id,
                started=True,
                finished=True,
            )
            db.commit()
            return {
                "document_id": document_id,
                "status": "skipped",
                "reason": f"file_type={item.file_type.value}",
            }
        if not item.file_path:
            _mark(
                db, item,
                status=KGPipelineStatus.FAILED,
                stage="parse",
                error="document has no file_path",
                task_id=task_id,
                started=True,
                finished=True,
            )
            db.commit()
            # Deterministic — upload never landed a file. Retry won't help.
            raise NonRetryableError(f"KnowledgeItem {document_id} has no file_path")

        # Flip to RUNNING + stamp start time + task id.
        _mark(
            db, item,
            status=KGPipelineStatus.RUNNING,
            stage="parse",
            error=None,
            task_id=task_id,
            started=True,
            finished=False,
        )
        db.commit()

    # ── Stage runner ─────────────────────────────────────────────────
    # Each stage: stamp kg_stage, run the work, bubble up on failure.
    # The stage fn gets its own SyncSession so failures inside don't
    # poison the status-update session.

    summary: dict[str, Any] = {"document_id": document_id}

    _run_stage(document_id, "parse", task_id, lambda: parse_and_persist(document_id),
               summary)
    _run_stage(document_id, "index", task_id, lambda: _stage_index(document_id),
               summary)
    _run_stage(document_id, "vectorize", task_id, lambda: _stage_vectorize(document_id),
               summary)
    _run_stage(document_id, "extract", task_id, lambda: _stage_extract(document_id),
               summary)

    # All stages succeeded — mark DONE.
    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is not None:
            _mark(
                db, item,
                status=KGPipelineStatus.DONE,
                stage="extract",
                error=None,
                task_id=task_id,
                started=False,
                finished=True,
            )
            db.commit()

    summary["status"] = "done"
    return summary


# ── Internals ────────────────────────────────────────────────────────

def _run_stage(
    document_id: int,
    stage: str,
    task_id: str | None,
    work: Callable[[], dict[str, Any] | None],
    summary: dict[str, Any],
) -> None:
    """Stamp the stage, run its work, accumulate results into summary.

    On exception, flip status to FAILED with stage + error captured
    for ops, then re-raise so Celery's retry policy triggers.
    """
    # Stamp the stage first so "RUNNING @ extract" is visible while
    # the LLM is churning — poll callers see forward progress.
    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is not None:
            item.kg_stage = stage
            db.commit()

    try:
        result = work()
    except Exception as exc:  # noqa: BLE001
        log.exception("kg_pipeline stage=%s doc=%s failed", stage, document_id)
        with SyncSession() as db:
            item = db.get(KnowledgeItem, document_id)
            if item is not None:
                _mark(
                    db, item,
                    status=KGPipelineStatus.FAILED,
                    stage=stage,
                    error=_truncate(str(exc), 2000),
                    task_id=task_id,
                    started=False,
                    finished=True,
                )
                db.commit()
        raise

    if result:
        summary[stage] = result


def _stage_index(document_id: int) -> dict[str, Any]:
    """Run the ES indexing stage — same code path as `ekm.docs.index`."""
    from app.services.es_sync import bulk_index_chunks, index_item

    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is None:
            # Row was deleted mid-pipeline — deterministic.
            raise NonRetryableError(
                f"KnowledgeItem {document_id} vanished mid-pipeline",
            )

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

        indexed = bulk_index_chunks(
            document_id, [(idx, content) for idx, content in chunks],
        )
        index_item(document_id, {
            "id": document_id,
            "name": item.name,
            "description": item.description,
            "file_type": (
                item.file_type.value
                if hasattr(item.file_type, "value") else str(item.file_type)
            ),
            "mime_type": item.mime_type,
            "uploader_id": item.uploader_id,
            "category_id": item.category_id,
            "tags": list(tag_names),
            "created_at": item.created_at.isoformat() if item.created_at else None,
        })

    return {"indexed_chunks": indexed}


def _stage_vectorize(document_id: int) -> dict[str, Any]:
    """Run the Qdrant embed + upsert stage — mirrors `ekm.docs.vectorize`."""
    from app.services.embeddings import embedder
    from app.services.qdrant_client import ensure_collection, upsert_chunks

    ensure_collection()

    with SyncSession() as db:
        rows = db.execute(
            select(DocumentChunk.id, DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == document_id)
            .order_by(DocumentChunk.chunk_index)
        ).all()
        if not rows:
            return {"vectorized": 0}

        vectors = embedder.embed([r.content for r in rows])
        triples = [(r.chunk_index, r.content, vec) for r, vec in zip(rows, vectors)]
        count = upsert_chunks(document_id, triples)

        for r in rows:
            db.execute(
                update(DocumentChunk)
                .where(DocumentChunk.id == r.id)
                .values(vector_id=str(document_id * 1_000_000 + r.chunk_index))
            )
        db.commit()

    return {"vectorized": count}


def _stage_extract(document_id: int) -> dict[str, Any]:
    """Run LLM NER + KG persistence stage."""
    from app.services.kg_extract import extract_and_persist

    with SyncSession() as db:
        result = extract_and_persist(db, document_id)
        db.commit()
    return result


def _mark(
    db: Session,
    item: KnowledgeItem,
    *,
    status: KGPipelineStatus,
    stage: str | None,
    error: str | None,
    task_id: str | None,
    started: bool,
    finished: bool,
) -> None:
    """Write pipeline state to the KnowledgeItem row. Caller commits."""
    item.kg_status = status
    item.kg_stage = stage
    item.kg_error = error
    if task_id is not None:
        item.kg_task_id = task_id
    now = datetime.now(timezone.utc)
    if started:
        item.kg_started_at = now
    if finished:
        item.kg_completed_at = now


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"
