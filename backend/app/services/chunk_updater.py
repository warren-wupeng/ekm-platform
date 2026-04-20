"""Incremental chunk update service (Issue #43, US-071).

Compares new chunks (from re-parse) against existing current chunks
using content hashes, then:
  - Unchanged chunks: keep as-is (no re-indexing).
  - Removed chunks: mark is_current=False, delete from ES/Qdrant.
  - Added chunks: insert to Postgres, index to ES/Qdrant, generate K-Card.

The hash-based diff avoids full re-vectorization when only a small part
of a document changes. Content hash = sha256(text)[:16].
"""
from __future__ import annotations

import hashlib
import logging
import unicodedata
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.document import DocumentChunk
from app.services.chunker import Chunk, chunk_text

log = logging.getLogger(__name__)


def content_hash(text: str) -> str:
    """SHA-256 truncated to 16 hex chars. NFC-normalized for CJK stability."""
    normalized = unicodedata.normalize("NFC", text)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


@dataclass
class ChunkDiff:
    """Result of comparing new chunks against existing current chunks."""
    kept: list[DocumentChunk]      # unchanged, still current
    removed: list[DocumentChunk]   # old chunks to retire
    added: list[Chunk]             # new chunks to insert
    doc_version: int               # bumped version number


def diff_chunks(
    db: Session,
    document_id: int,
    new_text: str,
) -> ChunkDiff:
    """Parse new_text into chunks and diff against existing current chunks.

    Returns a ChunkDiff describing what to keep, remove, and add.
    Does NOT mutate DB — caller applies the diff.
    """
    # Current chunks in DB.
    current = db.execute(
        select(DocumentChunk)
        .where(
            DocumentChunk.knowledge_item_id == document_id,
            DocumentChunk.is_current.is_(True),
        )
        .order_by(DocumentChunk.chunk_index)
    ).scalars().all()

    # Compute max doc_version from all chunks (including retired).
    max_ver_row = db.execute(
        select(DocumentChunk.doc_version)
        .where(DocumentChunk.knowledge_item_id == document_id)
        .order_by(DocumentChunk.doc_version.desc())
        .limit(1)
    ).scalar_one_or_none()
    new_doc_version = (max_ver_row or 0) + 1

    # Build hash → chunk map for existing.
    existing_by_hash: dict[str, DocumentChunk] = {}
    for c in current:
        h = c.content_hash or content_hash(c.content)
        existing_by_hash[h] = c

    # Parse new text into chunks + compute hashes.
    new_chunks = chunk_text(new_text)
    new_hashes: dict[str, Chunk] = {}
    for c in new_chunks:
        h = content_hash(c.content)
        new_hashes[h] = c

    # Diff.
    existing_hash_set = set(existing_by_hash.keys())
    new_hash_set = set(new_hashes.keys())

    kept_hashes = existing_hash_set & new_hash_set
    removed_hashes = existing_hash_set - new_hash_set
    added_hashes = new_hash_set - existing_hash_set

    return ChunkDiff(
        kept=[existing_by_hash[h] for h in kept_hashes],
        removed=[existing_by_hash[h] for h in removed_hashes],
        added=[new_hashes[h] for h in added_hashes],
        doc_version=new_doc_version,
    )


def apply_diff(
    db: Session,
    document_id: int,
    diff: ChunkDiff,
) -> dict[str, Any]:
    """Apply a ChunkDiff to Postgres. Returns summary + new chunk IDs.

    Does NOT touch ES/Qdrant/K-Card — caller handles those separately
    so we can commit Postgres first (two-phase pattern).
    """
    # Retire removed chunks.
    for chunk in diff.removed:
        chunk.is_current = False

    # Insert added chunks.
    new_rows: list[DocumentChunk] = []
    for c in diff.added:
        row = DocumentChunk(
            knowledge_item_id=document_id,
            chunk_index=c.index,
            content=c.content,
            token_count=c.char_count,
            content_hash=content_hash(c.content),
            version=1,
            is_current=True,
            doc_version=diff.doc_version,
        )
        db.add(row)
        new_rows.append(row)

    # Update kept chunks' doc_version (they survive into new version).
    for chunk in diff.kept:
        chunk.doc_version = diff.doc_version

    db.flush()
    new_ids = [r.id for r in new_rows]

    return {
        "kept": len(diff.kept),
        "removed": len(diff.removed),
        "added": len(diff.added),
        "new_chunk_ids": new_ids,
        "doc_version": diff.doc_version,
    }
