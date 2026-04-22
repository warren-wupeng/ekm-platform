"""AI assistant chat endpoint (Server-Sent Events).

POST /api/v1/chat/stream  { "query": "...", "top_k": 5 }
  → text/event-stream

     event: tool_call
     data: {"tool": "vector_search", "status": "running"}

     event: sources
     data: [{"document_id":..., "chunk_index":..., "content":"...", "score":...}]

     event: delta
     data: "第一段回答..."

     event: done
     data: [DONE]

Backed by a Tool-calling Agent (see services/agent.py). The LLM dynamically
selects from four tools (vector_search, kg_stats, kg_query, unified_search).
Sources are only emitted for high-relevance vector hits (score ≥ 0.68).
"""
from __future__ import annotations

import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.deps import CurrentUser
from app.services.agent import stream_answer


router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=2000)
    top_k: int | None = Field(None, ge=1, le=20)


def _sse_format(event: str, data) -> bytes:
    """Render one SSE frame. data may be str or JSON-serializable."""
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    # SSE wants `data:` lines; multi-line data must be split — our deltas
    # are short enough that embedded newlines are rare, but handle anyway.
    body = "\n".join(f"data: {line}" for line in payload.split("\n"))
    return f"event: {event}\n{body}\n\n".encode("utf-8")


@router.post("/stream")
async def chat_stream(req: ChatRequest, user: CurrentUser):
    async def gen():
        async for evt in stream_answer(req.query, top_k=req.top_k):
            yield _sse_format(evt["event"], evt["data"])

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering if it's ever in front
            "Connection": "keep-alive",
        },
    )
