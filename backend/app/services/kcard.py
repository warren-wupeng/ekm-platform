"""K-Card (Knowledge Card) generation service (Issue #43).

Generates chunk-level structured summaries via LLM. Each K-Card has
a title, summary (<=100 chars), and tags array.

Failure-safe: LLM errors are logged but never propagate — K-Card
generation must not block the document update pipeline.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.models.document import DocumentChunk, KCard

log = logging.getLogger(__name__)

_KCARD_PROMPT = """从以下文本提取知识卡片，用JSON输出：
{{"title": "简短标题", "summary": "50字以内的摘要", "tags": ["标签1", "标签2"]}}

文本：
{text}"""


def generate_kcard(chunk_text: str) -> dict[str, Any] | None:
    """Call LLM to generate a K-Card from chunk text. Returns parsed dict or None."""
    from app.services.llm_client import llm

    truncated = chunk_text[:500]
    prompt = _KCARD_PROMPT.format(text=truncated)

    try:
        raw = llm(prompt, max_tokens=256, temperature=0.2)
        # Try to parse JSON from the response.
        return _parse_json(raw)
    except Exception as exc:  # noqa: BLE001
        log.warning("K-Card LLM call failed: %s", exc)
        return None


def _parse_json(text: str) -> dict[str, Any] | None:
    """Extract the first JSON object from LLM output."""
    text = text.strip()
    # Try direct parse.
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try extracting from markdown code block.
    if "```" in text:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    return None


def generate_and_persist_kcard(db: Session, chunk: DocumentChunk) -> KCard | None:
    """Generate a K-Card for a chunk and persist to DB. Returns None on failure."""
    result = generate_kcard(chunk.content)
    if result is None:
        return None

    title = str(result.get("title", ""))[:500]
    summary = str(result.get("summary", ""))[:200]
    tags = result.get("tags", [])
    if not isinstance(tags, list):
        tags = []
    tags = [str(t)[:50] for t in tags[:10]]

    if not title:
        return None

    kcard = KCard(
        chunk_id=chunk.id,
        title=title,
        summary=summary,
        tags=tags,
    )
    db.add(kcard)
    db.flush()
    log.info("K-Card generated: chunk=%d title=%s", chunk.id, title[:30])
    return kcard
