#!/usr/bin/env python3
"""Backfill Elasticsearch indexes from existing Postgres data.

Usage:
    # From backend/ directory (with .env loaded):
    python -m scripts.backfill_es_index

    # Or via flyctl on staging:
    flyctl ssh console -a ekm-backend -C \
      "cd /app && python -m scripts.backfill_es_index"

Idempotent: ES index operations use document IDs as _id, so re-running
upserts over existing docs rather than creating duplicates.

Indexes populated:
  - ekm_items   (one doc per KnowledgeItem)
  - ekm_chunks  (one doc per DocumentChunk)
"""
import sys
from pathlib import Path

# Ensure the backend package is importable when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.models.document import DocumentChunk
from app.models.knowledge import KnowledgeItem, Tag, TagAssignment
from app.services.document_parse import SyncSession
from app.services.es_sync import bulk_index_chunks, index_item


def main() -> None:
    with SyncSession() as db:
        items = db.execute(
            select(KnowledgeItem).order_by(KnowledgeItem.id)
        ).scalars().all()

        if not items:
            print("No knowledge items found. Nothing to backfill.")
            return

        print(f"Found {len(items)} knowledge items. Starting backfill...")

        total_items = 0
        total_chunks = 0

        for item in items:
            # Fetch chunks for this item.
            chunks = db.execute(
                select(DocumentChunk.chunk_index, DocumentChunk.content)
                .where(DocumentChunk.knowledge_item_id == item.id)
                .order_by(DocumentChunk.chunk_index)
            ).all()

            # Fetch tags for this item.
            tag_names = db.execute(
                select(Tag.name)
                .join(TagAssignment, TagAssignment.tag_id == Tag.id)
                .where(TagAssignment.knowledge_item_id == item.id)
            ).scalars().all()

            # Index the item metadata into ekm_items.
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

            # Index chunks into ekm_chunks.
            if chunks:
                try:
                    n = bulk_index_chunks(
                        item.id,
                        [(idx, content) for idx, content in chunks],
                    )
                    total_chunks += n
                except Exception as exc:
                    print(f"  [ERROR] chunks for item {item.id}: {exc}")
                    continue

            print(f"  item {item.id:>4d}  {item.name:<40s}  chunks={len(chunks)}")

        print()
        print(f"Done. Indexed {total_items} items, {total_chunks} chunks.")


if __name__ == "__main__":
    main()
