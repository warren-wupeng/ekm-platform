"""Versioning helpers — snapshot + diff for KnowledgeItem.

These are independent of the router layer so any mutation path (upload
replace, rename, description edit, future PATCH /knowledge/{id}) can call
`snapshot_item()` and stay consistent.

Diffing uses Python's standard `difflib` in unified-diff format so the
frontend can render it with any off-the-shelf diff viewer.
"""
from __future__ import annotations

import difflib
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import DocumentChunk
from app.models.knowledge import KnowledgeItem
from app.models.version import KnowledgeVersion


async def _next_version_number(db: AsyncSession, item_id: int) -> int:
    max_v = (await db.execute(
        select(func.max(KnowledgeVersion.version_number))
        .where(KnowledgeVersion.knowledge_item_id == item_id)
    )).scalar()
    return (max_v or 0) + 1


async def _current_content_text(db: AsyncSession, item_id: int) -> str | None:
    """Rebuild the text snapshot from stored DocumentChunks (if any).

    Chunks are the source-of-truth for parsed content; versions just point
    at a concatenated copy frozen at snapshot time.
    """
    rows = (await db.execute(
        select(DocumentChunk.content)
        .where(DocumentChunk.knowledge_item_id == item_id)
        .order_by(DocumentChunk.chunk_index)
    )).scalars().all()
    if not rows:
        return None
    return "\n\n".join(rows)


async def snapshot_item(
    db: AsyncSession,
    item: KnowledgeItem,
    *,
    change_summary: str | None = None,
    created_by_id: int | None = None,
    commit: bool = False,
) -> KnowledgeVersion:
    """Create a new KnowledgeVersion row for `item`.

    Caller controls the transaction: pass `commit=True` for a one-shot
    snapshot, otherwise flush-only so it fits into a larger transaction.
    """
    vno = await _next_version_number(db, item.id)
    text = await _current_content_text(db, item.id)
    v = KnowledgeVersion(
        knowledge_item_id=item.id,
        version_number=vno,
        name_snapshot=item.name,
        description_snapshot=item.description,
        file_path_snapshot=item.file_path,
        size_snapshot=item.size,
        content_text=text,
        change_summary=change_summary,
        created_by_id=created_by_id,
    )
    db.add(v)
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(v)
    return v


def unified_diff(
    a_text: str | None,
    b_text: str | None,
    a_label: str = "v_a",
    b_label: str = "v_b",
) -> str:
    """Return a unified-diff string; empty text is rendered as empty file."""
    a_lines = (a_text or "").splitlines(keepends=True)
    b_lines = (b_text or "").splitlines(keepends=True)
    diff: Sequence[str] = list(difflib.unified_diff(
        a_lines, b_lines,
        fromfile=a_label, tofile=b_label,
        lineterm="",
    ))
    return "\n".join(diff)
