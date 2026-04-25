"""Text chunker.

Keep it dumb-and-good: split on paragraph boundaries first, then pack
paragraphs into ~target_chars windows with overlap. Good enough for RAG
without dragging in tiktoken/langchain at this stage.

Char-count is a cheap approximation of token-count; we'll swap in a real
tokenizer alongside the embedder in #22.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from itertools import pairwise

DEFAULT_TARGET_CHARS = 1200  # ~= 250-350 tokens for mixed CJK/EN
DEFAULT_OVERLAP_CHARS = 150


@dataclass
class Chunk:
    index: int
    content: str

    @property
    def char_count(self) -> int:
        return len(self.content)


_PARA_SPLIT = re.compile(r"\n\s*\n")


def chunk_text(
    text: str,
    target_chars: int = DEFAULT_TARGET_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[Chunk]:
    """Split `text` into overlapping chunks near `target_chars`.

    Algorithm:
      1. Split on blank-line paragraph breaks.
      2. Greedily pack paragraphs into a buffer; flush when exceeding target.
      3. If a single paragraph is larger than target, hard-split at char boundary.
      4. Add `overlap_chars` tail from previous chunk to the next (helps retrieval).
    """
    text = (text or "").strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in _PARA_SPLIT.split(text) if p.strip()]
    chunks: list[str] = []
    buf = ""

    def _flush():
        nonlocal buf
        if buf.strip():
            chunks.append(buf.strip())
        buf = ""

    for para in paragraphs:
        # Hard-split oversized paragraphs (long code blocks, tables).
        if len(para) > target_chars:
            _flush()
            for i in range(0, len(para), target_chars):
                chunks.append(para[i : i + target_chars])
            continue

        if len(buf) + len(para) + 2 <= target_chars:
            buf = f"{buf}\n\n{para}" if buf else para
        else:
            _flush()
            buf = para
    _flush()

    if overlap_chars <= 0 or len(chunks) <= 1:
        return [Chunk(i, c) for i, c in enumerate(chunks)]

    # Stitch overlap: prepend tail of previous chunk.
    with_overlap: list[str] = [chunks[0]]
    for prev, cur in pairwise(chunks):
        tail = prev[-overlap_chars:]
        with_overlap.append(f"{tail}\n\n{cur}")
    return [Chunk(i, c) for i, c in enumerate(with_overlap)]
