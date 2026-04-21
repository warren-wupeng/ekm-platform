"""RAG orchestration.

Given a user query:
  1. Embed the query (sync — cheap; a single forward pass)
  2. Retrieve top-K chunks from Qdrant
  3. Build a grounded prompt with inline citations [1], [2], ...
  4. Stream assistant tokens back via LiteLLM

Keep prompt construction simple and auditable. Future tuning (re-ranking,
hybrid ES + Qdrant fusion, citation de-duplication) plugs in here without
touching the router.
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.knowledge import KnowledgeItem
from app.services.embeddings import embedder
from app.services.llm_client import llm
from app.services.qdrant_client import search as qdrant_search

log = logging.getLogger(__name__)


SYSTEM_PROMPT = (
    "你是 EKM 知识库助手。基于「参考资料」回答用户问题。"
    "如果参考资料中没有答案，直接说明「资料中未找到相关信息」，不要编造。"
    "在引用具体内容时，在句末标注来源编号，例如 [1]、[2]。"
    "用简洁、准确的中文回答。"
)


def _retrieve(query: str, top_k: int) -> list[dict]:
    """Blocking retrieve — runs in a threadpool via asyncio.to_thread."""
    vec = embedder.embed([query])[0]
    return qdrant_search(vec, top_k=top_k)


def _build_context(hits: list[dict]) -> str:
    if not hits:
        return "（无相关资料）"
    lines = []
    for i, h in enumerate(hits, 1):
        lines.append(f"[{i}] (doc={h['document_id']}, chunk={h['chunk_index']})\n{h['content']}")
    return "\n\n".join(lines)


async def stream_answer(
    query: str, top_k: int | None = None,
) -> AsyncIterator[dict]:
    """Async generator yielding SSE events.

    Yields events of the form:
        {"event": "sources", "data": [...hits...]}
        {"event": "delta",   "data": "..."}   (repeated)
        {"event": "done",    "data": "[DONE]"}
    """
    k = top_k or settings.RAG_TOP_K
    hits = await asyncio.to_thread(_retrieve, query, k)

    # Enrich hits with document filenames for the frontend sources panel.
    if hits:
        doc_ids = list({h["document_id"] for h in hits})
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(
                select(KnowledgeItem.id, KnowledgeItem.name)
                .where(KnowledgeItem.id.in_(doc_ids))
            )).all()
        name_map = {row.id: row.name for row in rows}
        for h in hits:
            h["filename"] = name_map.get(h["document_id"])

    yield {"event": "sources", "data": hits}

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"参考资料：\n{_build_context(hits)}\n\n"
                f"用户问题：{query}"
            ),
        },
    ]

    try:
        async for delta in llm.stream(messages):
            if delta:
                yield {"event": "delta", "data": delta}
    except Exception as exc:
        log.exception("LLM stream failed: %s", exc)
        yield {"event": "error", "data": f"LLM error: {type(exc).__name__}: {exc}"}
        return

    yield {"event": "done", "data": "[DONE]"}
