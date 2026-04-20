"""Document update — incremental re-index pipeline (Issue #43, US-071).

Orchestrates the incremental update flow:
1. Re-parse document via Tika.
2. Diff new chunks against existing (by content hash).
3. Retire removed chunks (is_current=False), insert added chunks.
4. Re-index only changed chunks to ES/Qdrant.
5. Generate K-Cards for new chunks (failure-safe).

Designed to run inside a Celery task (sync context).
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.document import DocumentChunk
from app.models.knowledge import KnowledgeItem
from app.services.chunk_updater import ChunkDiff, apply_diff, content_hash, diff_chunks
from app.services.document_parse import SyncSession

log = logging.getLogger(__name__)


def run_incremental_update(document_id: int) -> dict[str, Any]:
    """Full incremental update for one document. Returns summary."""
    from app.services.kcard import generate_and_persist_kcard

    with SyncSession() as db:
        item = db.get(KnowledgeItem, document_id)
        if item is None:
            raise ValueError(f"KnowledgeItem {document_id} not found")
        if not item.file_path:
            raise ValueError(f"KnowledgeItem {document_id} has no file_path")

        # Step 1: Re-parse (download from storage, send bytes to Tika).
        import asyncio
        from app.services import storage
        from app.services.tika_client import tika

        file_bytes = storage.download(item.file_path)

        async def _extract():
            return await tika.extract(file_bytes)

        loop = asyncio.new_event_loop()
        try:
            text, _meta = loop.run_until_complete(_extract())
        finally:
            loop.close()
        log.info("incremental_update doc=%d re-parsed chars=%d", document_id, len(text))

        # Step 2: Diff.
        diff = diff_chunks(db, document_id, text)

        if not diff.removed and not diff.added:
            log.info("incremental_update doc=%d no changes detected", document_id)
            return {
                "document_id": document_id,
                "status": "no_changes",
                "doc_version": diff.doc_version - 1,
            }

        # Steps 3+4 combined: apply diff + sync search indexes inside a
        # savepoint.  If ES/Qdrant writes fail, the savepoint rolls back
        # so Postgres never has is_current=True chunks that search can't
        # find (the "search blind-spot" Sage flagged).
        try:
            with db.begin_nested():
                # Step 3: Apply diff to Postgres (within savepoint).
                result = apply_diff(db, document_id, diff)
                db.flush()

                log.info(
                    "incremental_update doc=%d kept=%d removed=%d added=%d ver=%d",
                    document_id, result["kept"], result["removed"],
                    result["added"], result["doc_version"],
                )

                # Step 4: sync search indexes — must succeed or rollback.
                _sync_search_indexes(db, document_id, diff, result)
            # Savepoint released — now commit the outer transaction.
            db.commit()
        except Exception:
            # Savepoint rolled back — old chunks stay is_current=True,
            # doc_version unchanged.  Postgres and search stay consistent.
            # Re-raise so Celery's autoretry_for triggers a retry.
            log.exception(
                "incremental_update doc=%d search sync failed, diff rolled back",
                document_id,
            )
            raise

        # Step 5: Generate K-Cards for added chunks (failure-safe).
        kcards_generated = 0
        for chunk_id in result["new_chunk_ids"]:
            chunk = db.get(DocumentChunk, chunk_id)
            if chunk is None:
                continue
            try:
                kcard = generate_and_persist_kcard(db, chunk)
                if kcard is not None:
                    kcards_generated += 1
            except Exception as exc:  # noqa: BLE001
                log.warning("K-Card generation failed chunk=%d: %s", chunk_id, exc)

        db.commit()
        result["kcards_generated"] = kcards_generated
        result["document_id"] = document_id
        result["status"] = "updated"
        return result


def _sync_search_indexes(
    db: Session,
    document_id: int,
    diff: ChunkDiff,
    result: dict[str, Any],
) -> None:
    """Sync changed chunks to ES and Qdrant. Raises on failure.

    Called inside a savepoint — if this raises, the caller rolls back
    both the Postgres diff and this sync attempt, keeping Postgres and
    search consistent.
    """
    from app.services.es_sync import bulk_index_chunks

    # Delete removed chunks from ES.
    for chunk in diff.removed:
        from app.services.es_sync import _client as es_client
        client = es_client()
        client.delete(
            index="ekm_chunks",
            id=f"{document_id}:{chunk.chunk_index}",
            ignore=[404],
        )

    # Delete removed chunks from Qdrant.
    for chunk in diff.removed:
        from app.services.qdrant_client import delete_points
        point_id = document_id * 1_000_000 + chunk.chunk_index
        delete_points([str(point_id)])

    # Index added chunks to ES + Qdrant.
    if result["new_chunk_ids"]:
        from sqlalchemy import select

        new_db_chunks = db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.id.in_(result["new_chunk_ids"]))
            .order_by(DocumentChunk.chunk_index)
        ).scalars().all()

        bulk_index_chunks(
            document_id,
            [(c.chunk_index, c.content) for c in new_db_chunks],
        )

        from app.services.embeddings import embedder
        from app.services.qdrant_client import ensure_collection, upsert_chunks

        ensure_collection()
        vectors = embedder.embed([c.content for c in new_db_chunks])
        triples = [
            (c.chunk_index, c.content, vec)
            for c, vec in zip(new_db_chunks, vectors)
        ]
        upsert_chunks(document_id, triples)
