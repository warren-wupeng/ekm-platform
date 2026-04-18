"""AI content generation — summarize existing items, draft new content.

Two SSE endpoints, same shape as /chat/stream (token deltas framed as
`event: delta` with a final `event: done`).

  POST /api/v1/knowledge/{id}/summarize   { length?: "short"|"medium"|"long" }
  POST /api/v1/ai/draft                   { topic: str, outline?: str, style?: str }

Both stream via LiteLLM (see services/llm_client.py). The model is driven
by settings.LLM_MODEL — no hardcoded provider.

Persistence is *not* done here: the frontend decides whether to write the
result back as a knowledge item / version. Keeps this endpoint side-effect
free so it can be re-tried safely.
"""
from __future__ import annotations

import json
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.knowledge import KnowledgeItem
from app.services.llm_client import llm
from app.services.versioning import _current_content_text


router = APIRouter(prefix="/api/v1", tags=["ai"])


# ─── SSE helpers ────────────────────────────────────────────────────────────
def _sse(event: str, data) -> bytes:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    body = "\n".join(f"data: {line}" for line in payload.split("\n"))
    return f"event: {event}\n{body}\n\n".encode("utf-8")


def _stream_headers() -> dict:
    return {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }


async def _stream_llm(messages: list[dict]) -> AsyncIterator[bytes]:
    """Frame an LLM token stream as SSE deltas + a terminal done event."""
    try:
        async for delta in llm.stream(messages):
            yield _sse("delta", delta)
    except Exception as exc:  # noqa: BLE001 — we want the frontend to see failure
        yield _sse("error", {"message": str(exc)})
    yield _sse("done", "[DONE]")


# ─── Schemas ────────────────────────────────────────────────────────────────
class SummarizeRequest(BaseModel):
    # "short" ≈ 80 words, "medium" ≈ 200, "long" ≈ 500. Translated to a
    # natural-language hint in the prompt, not a hard max_tokens.
    length: str = Field("medium", pattern="^(short|medium|long)$")


class DraftRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=500)
    outline: str | None = Field(None, max_length=4000)
    style: str | None = Field(None, max_length=200)


# ─── Prompt builders ────────────────────────────────────────────────────────
# Keeping these inline instead of a PromptLibrary abstraction — two prompts
# don't justify the indirection. Revisit once we hit ~5 distinct tasks.
_LENGTH_HINT = {
    "short":  "约 80 字",
    "medium": "约 200 字",
    "long":   "约 500 字",
}

# The raw content can be very large; keep what fits comfortably in a single
# model context and let the caller know it was truncated via a `truncated`
# meta event. 20k chars ≈ 5k tokens for mixed CJK/English — well under any
# modern 128k-context model but leaves room for the system + prompt scaffolding.
_MAX_CONTENT_CHARS = 20_000


def _build_summary_messages(title: str, body: str, length: str) -> list[dict]:
    hint = _LENGTH_HINT.get(length, _LENGTH_HINT["medium"])
    system = (
        "你是企业知识库的摘要助手。针对给定文档，输出一段结构化的中文摘要，"
        "突出关键事实、结论和可操作点。不要编造原文没有的信息。"
    )
    user = (
        f"# 文档标题\n{title}\n\n"
        f"# 文档正文\n{body}\n\n"
        f"# 摘要要求\n长度：{hint}。\n"
        "先给 1 句话总览，再分点列出关键要点。"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user",   "content": user},
    ]


def _build_draft_messages(topic: str, outline: str | None, style: str | None) -> list[dict]:
    system = (
        "你是企业知识库的写作助手。根据用户给定的主题与可选大纲，生成一篇"
        "结构清晰、语气专业、可直接入库的中文草稿。使用 Markdown 标题分层。"
    )
    parts = [f"# 主题\n{topic}"]
    if outline:
        parts.append(f"# 大纲\n{outline}")
    if style:
        parts.append(f"# 风格要求\n{style}")
    parts.append("请直接输出草稿正文，不要额外解释。")
    return [
        {"role": "system", "content": system},
        {"role": "user",   "content": "\n\n".join(parts)},
    ]


# ─── Endpoints ──────────────────────────────────────────────────────────────
@router.post("/knowledge/{item_id}/summarize")
async def summarize_item(
    item_id: int,
    req: SummarizeRequest,
    db: DB,
    user: CurrentUser,
):
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == item_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="knowledge item not found")

    text = await _current_content_text(db, item_id)
    if not text:
        # The frontend should trigger /parse first; tell them clearly.
        raise HTTPException(
            status_code=409,
            detail="no parsed content; run /documents/{id}/parse first",
        )

    truncated = len(text) > _MAX_CONTENT_CHARS
    body = text[:_MAX_CONTENT_CHARS] if truncated else text

    messages = _build_summary_messages(item.name or "未命名文档", body, req.length)

    async def gen():
        # Metadata frame up front so the UI can show "summarising… (truncated)".
        yield _sse("meta", {
            "item_id": item_id,
            "length": req.length,
            "truncated": truncated,
            "content_chars": len(text),
        })
        async for frame in _stream_llm(messages):
            yield frame

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_stream_headers())


@router.post("/ai/draft")
async def draft_content(req: DraftRequest, user: CurrentUser):
    messages = _build_draft_messages(req.topic, req.outline, req.style)

    async def gen():
        yield _sse("meta", {"topic": req.topic})
        async for frame in _stream_llm(messages):
            yield frame

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_stream_headers())
