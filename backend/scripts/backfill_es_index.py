#!/usr/bin/env python3
"""Backfill Elasticsearch + Qdrant indexes from existing Postgres data.

Usage:
    # From backend/ directory (with .env loaded):
    python -m scripts.backfill_es_index

    # Dry-run (report what would be indexed, no writes):
    python -m scripts.backfill_es_index --dry-run

    # ES only (skip Qdrant):
    python -m scripts.backfill_es_index --es-only

    # Qdrant only (skip ES):
    python -m scripts.backfill_es_index --qdrant-only

    # Custom batch size:
    python -m scripts.backfill_es_index --batch-size 200

    # Via flyctl on staging:
    flyctl ssh console -a ekm-backend -C \
      "cd /app && python -m scripts.backfill_es_index"

Idempotent: ES uses document IDs as _id, Qdrant uses stable int IDs
(doc_id * 1_000_000 + chunk_index), so re-running upserts over
existing data without duplicates.

Indexes populated:
  ES:     ekm_items  (one doc per KnowledgeItem)
          ekm_chunks (one doc per DocumentChunk)
  Qdrant: ekm_chunks (one vector per DocumentChunk)
"""
import argparse
import sys
import time
from pathlib import Path

# Ensure the backend package is importable when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select

from app.models.document import DocumentChunk
from app.models.knowledge import KnowledgeItem, Tag, TagAssignment
from app.services.document_parse import SyncSession


def _backfill_es(db, items, batch_size: int, dry_run: bool) -> tuple[int, int]:
    """Backfill ES indexes. Returns (items_indexed, chunks_indexed)."""
    from app.services.es_sync import bulk_index_chunks, index_item

    total_items = 0
    total_chunks = 0

    for i, item in enumerate(items, 1):
        chunks = db.execute(
            select(DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == item.id)
            .order_by(DocumentChunk.chunk_index)
        ).all()

        tag_names = db.execute(
            select(Tag.name)
            .join(TagAssignment, TagAssignment.tag_id == Tag.id)
            .where(TagAssignment.knowledge_item_id == item.id)
        ).scalars().all()

        if dry_run:
            print(f"  [DRY-RUN] item {item.id:>4d}  {item.name:<40s}  chunks={len(chunks)}")
            total_items += 1
            total_chunks += len(chunks)
            continue

        # Index item metadata.
        try:
            index_item(item.id, {
                "id": item.id,
                "name": item.name,
                "description": item.description,
                "file_type": (
                    item.file_type.value
                    if hasattr(item.file_type, "value")
                    else str(item.file_type)
                ),
                "mime_type": item.mime_type,
                "uploader_id": item.uploader_id,
                "category_id": item.category_id,
                "tags": list(tag_names),
                "created_at": (
                    item.created_at.isoformat() if item.created_at else None
                ),
            })
            total_items += 1
        except Exception as exc:
            print(f"  [ERROR] item {item.id} ({item.name}): {exc}")
            continue

        # Index chunks in batches.
        chunk_list = [(idx, content) for idx, content in chunks]
        for offset in range(0, len(chunk_list), batch_size):
            batch = chunk_list[offset : offset + batch_size]
            try:
                n = bulk_index_chunks(item.id, batch)
                total_chunks += n
            except Exception as exc:
                print(f"  [ERROR] chunks for item {item.id} batch@{offset}: {exc}")

        if i % 50 == 0:
            print(f"  progress: {i}/{len(items)} items indexed")

        print(f"  item {item.id:>4d}  {item.name:<40s}  chunks={len(chunks)}")

    return total_items, total_chunks


def _backfill_qdrant(db, items, batch_size: int, dry_run: bool) -> int:
    """Backfill Qdrant vectors. Returns total vectors upserted."""
    from app.services.embeddings import embedder
    from app.services.qdrant_client import ensure_collection, upsert_chunks

    if not dry_run:
        ensure_collection()

    total_vectors = 0

    for i, item in enumerate(items, 1):
        chunks = db.execute(
            select(DocumentChunk.chunk_index, DocumentChunk.content)
            .where(DocumentChunk.knowledge_item_id == item.id)
            .order_by(DocumentChunk.chunk_index)
        ).all()

        if not chunks:
            continue

        if dry_run:
            print(f"  [DRY-RUN] qdrant item {item.id:>4d}  {item.name:<40s}  vectors={len(chunks)}")
            total_vectors += len(chunks)
            continue

        # Embed + upsert in batches.
        chunk_list = [(idx, content) for idx, content in chunks]
        for offset in range(0, len(chunk_list), batch_size):
            batch = chunk_list[offset : offset + batch_size]
            try:
                texts = [content for _, content in batch]
                vectors = embedder.embed(texts)
                triples = [
                    (idx, content, vec)
                    for (idx, content), vec in zip(batch, vectors)
                ]
                n = upsert_chunks(item.id, triples)
                total_vectors += n
            except Exception as exc:
                print(f"  [ERROR] qdrant item {item.id} batch@{offset}: {exc}")

        if i % 50 == 0:
            print(f"  qdrant progress: {i}/{len(items)} items")

        print(f"  qdrant item {item.id:>4d}  {item.name:<40s}  vectors={len(chunks)}")

    return total_vectors


def _count_es() -> tuple[int, int]:
    """Return (items_count, chunks_count) from ES indexes."""
    from app.services.es_sync import _client
    client = _client()
    try:
        items_count = client.count(index="ekm_items")["count"]
    except Exception:
        items_count = 0
    try:
        chunks_count = client.count(index="ekm_chunks")["count"]
    except Exception:
        chunks_count = 0
    return items_count, chunks_count


def _count_qdrant() -> int:
    """Return vector count from Qdrant collection."""
    from app.core.config import settings
    from app.services.qdrant_client import _client
    try:
        c = _client()
        info = c.get_collection(settings.QDRANT_COLLECTION)
        return info.points_count
    except Exception:
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill ES + Qdrant from Postgres")
    parser.add_argument("--dry-run", action="store_true", help="Report only, no writes")
    parser.add_argument("--es-only", action="store_true", help="Backfill ES only")
    parser.add_argument("--qdrant-only", action="store_true", help="Backfill Qdrant only")
    parser.add_argument("--batch-size", type=int, default=500, help="Chunks per batch (default 500)")
    args = parser.parse_args()

    do_es = not args.qdrant_only
    do_qdrant = not args.es_only

    with SyncSession() as db:
        # Count DB records.
        db_items = db.execute(select(func.count()).select_from(KnowledgeItem)).scalar_one()
        db_chunks = db.execute(
            select(func.count()).select_from(DocumentChunk)
        ).scalar_one()

        print(f"Postgres: {db_items} items, {db_chunks} current chunks")

        if do_es:
            es_items, es_chunks = _count_es()
            print(f"ES:       {es_items} items, {es_chunks} chunks")
            if es_items >= db_items and es_chunks >= db_chunks:
                print("ES counts match or exceed DB — may not need backfill.")

        if do_qdrant:
            qdrant_count = _count_qdrant()
            print(f"Qdrant:   {qdrant_count} vectors")
            if qdrant_count >= db_chunks:
                print("Qdrant count matches or exceeds DB — may not need backfill.")

        print()

        # Load all items.
        items = db.execute(
            select(KnowledgeItem).order_by(KnowledgeItem.id)
        ).scalars().all()

        if not items:
            print("No knowledge items found. Nothing to backfill.")
            return

        if args.dry_run:
            print("[DRY-RUN MODE — no writes will be made]\n")

        # ES backfill.
        if do_es:
            print(f"--- ES backfill ({len(items)} items, batch_size={args.batch_size}) ---")
            t0 = time.time()
            es_items_done, es_chunks_done = _backfill_es(db, items, args.batch_size, args.dry_run)
            elapsed = time.time() - t0
            print(f"\nES done: {es_items_done} items, {es_chunks_done} chunks in {elapsed:.1f}s\n")

        # Qdrant backfill.
        if do_qdrant:
            print(f"--- Qdrant backfill ({len(items)} items, batch_size={args.batch_size}) ---")
            t0 = time.time()
            qdrant_done = _backfill_qdrant(db, items, args.batch_size, args.dry_run)
            elapsed = time.time() - t0
            print(f"\nQdrant done: {qdrant_done} vectors in {elapsed:.1f}s\n")

        # Final counts.
        if not args.dry_run:
            print("--- Post-backfill counts ---")
            if do_es:
                es_items, es_chunks = _count_es()
                print(f"ES:       {es_items} items, {es_chunks} chunks")
            if do_qdrant:
                qdrant_count = _count_qdrant()
                print(f"Qdrant:   {qdrant_count} vectors")
            print(f"Postgres: {db_items} items, {db_chunks} current chunks")


if __name__ == "__main__":
    main()
