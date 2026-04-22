"""Tool-calling Agent — replaces pure RAG (rag.py).

Flow:
  query
    → LLM decides tools (non-streaming, up to 2 ReAct rounds)
    → parallel tool execution
    → LLM streams final answer
    → SSE to frontend

Tools (4):
  vector_search  — semantic retrieval with score ≥ 0.68 threshold
  kg_stats       — knowledge graph statistics (node/rel counts, type distribution)
  kg_query       — structured KG entity query via controlled-vocabulary Cypher
  unified_search — cross-document / post / tag full-text search

Key improvements over pure RAG:
- ``sources`` event only emitted when vector_search found high-relevance hits,
  fixing the "Cited N snippets" contradiction bug.
- Meta questions (e.g. "how large is your knowledge graph?") answered via
  ``kg_stats`` rather than failing with a false fallback message.
- Tool failures auto-degrade; internal errors are never exposed to the client.
- New ``tool_call`` SSE event lets the frontend show progress indicators.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.graph import graph
from app.models.knowledge import KnowledgeItem
from app.services.embeddings import embedder
from app.services.kg_query import KGQueryError, build_match_query
from app.services.llm_client import llm
from app.services.qdrant_client import search as qdrant_search
from app.services.search_aggregator import search_all

log = logging.getLogger(__name__)

# Only surface vector-search hits with score above this threshold.
_MIN_SCORE: float = 0.68

SYSTEM_PROMPT = (
    "你是 EKM 知识库助手。你可以使用工具查询知识库和知识图谱来回答问题。\n"
    "根据问题类型选择合适的工具：\n"
    "- 语义检索文档内容用 vector_search\n"
    "- 查询知识图谱规模/统计用 kg_stats\n"
    "- 结构化查询知识图谱实体用 kg_query\n"
    "- 跨文档/帖子/标签全文搜索用 unified_search\n\n"
    "基于工具返回的结果回答用户；如果工具未找到相关信息，直接说明。"
    "引用具体内容时标注来源编号，例如 [1]、[2]。"
    "用简洁、准确的中文回答。"
)

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "vector_search",
            "description": "在知识库中进行语义（向量）检索，返回最相关的文档片段",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索查询文本"},
                    "top_k": {
                        "type": "integer",
                        "description": "返回结果数量（默认5，最大20）",
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kg_stats",
            "description": "查询知识图谱整体统计信息：节点总数、关系总数、实体类型分布",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "kg_query",
            "description": "结构化查询知识图谱中的实体节点，支持按类型和属性过滤",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity_type": {
                        "type": "string",
                        "description": "实体类型，如 Person、Organization、Concept 等",
                    },
                    "where_props": {
                        "type": "object",
                        "description": "属性过滤条件，例如 {\"name\": \"张三\"}",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "最大返回数量（默认20，最大200）",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "unified_search",
            "description": "跨文档、社区帖子、标签进行统一全文搜索",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "types": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["documents", "posts", "tags"],
                        },
                        "description": "搜索范围，不填则搜全部",
                    },
                    "size": {
                        "type": "integer",
                        "description": "每类返回结果数量（默认10）",
                        "default": 10,
                    },
                },
                "required": ["query"],
            },
        },
    },
]


# ── tool executors ────────────────────────────────────────────────────────────


def _do_retrieve(query: str, top_k: int) -> list[dict]:
    """Blocking vector search — called via asyncio.to_thread."""
    vec = embedder.embed([query])[0]
    hits = qdrant_search(vec, top_k=top_k)
    return [h for h in hits if h["score"] >= _MIN_SCORE]


async def _exec_vector_search(args: dict) -> dict:
    query = str(args.get("query", ""))
    raw_top_k = args.get("top_k", settings.RAG_TOP_K)
    try:
        top_k = int(raw_top_k)
    except (TypeError, ValueError):
        top_k = int(settings.RAG_TOP_K)
    top_k = min(top_k, 20)
    try:
        hits = await asyncio.to_thread(_do_retrieve, query, top_k)
    except Exception as exc:
        log.warning("vector_search failed: %s", exc)
        return {"error": "无法执行向量检索", "hits": []}

    if hits:
        doc_ids = list({h["document_id"] for h in hits})
        try:
            async with AsyncSessionLocal() as db:
                rows = (
                    await db.execute(
                        select(KnowledgeItem.id, KnowledgeItem.name).where(
                            KnowledgeItem.id.in_(doc_ids)
                        )
                    )
                ).all()
            name_map = {row.id: row.name for row in rows}
            for h in hits:
                h["filename"] = name_map.get(h["document_id"])
        except Exception as exc:
            log.warning("vector_search filename enrichment failed: %s", exc)

    return {"hits": hits, "count": len(hits)}


async def _exec_kg_stats(_args: dict) -> dict:
    try:
        nodes = await graph.run("MATCH (n:Entity) RETURN count(n) AS node_count")
        rels = await graph.run(
            "MATCH (:Entity)-[r]->(:Entity) RETURN count(r) AS rel_count"
        )
        types = await graph.run(
            "MATCH (n:Entity) UNWIND labels(n) AS lbl "
            "WHERE lbl <> 'Entity' "
            "RETURN lbl AS type, count(n) AS cnt ORDER BY cnt DESC LIMIT 20"
        )
        return {
            "node_count": nodes[0]["node_count"] if nodes else 0,
            "rel_count": rels[0]["rel_count"] if rels else 0,
            "type_distribution": {r["type"]: r["cnt"] for r in types},
        }
    except Exception as exc:
        log.warning("kg_stats failed: %s", exc)
        return {"error": "无法获取知识图谱统计信息"}


async def _exec_kg_query(args: dict) -> dict:
    try:
        built = build_match_query(
            entity_type=args.get("entity_type"),
            where_props=args.get("where_props"),
            limit=args.get("limit"),
        )
        rows = await graph.run(built.cypher, built.params)
        return {
            "nodes": [
                {
                    "external_id": r.get("external_id"),
                    "label": r.get("label"),
                    "labels": list(r.get("labels") or []),
                    "properties": dict(r.get("properties") or {}),
                }
                for r in rows
                if r.get("external_id")
            ]
        }
    except KGQueryError as exc:
        return {"error": f"查询参数无效: {exc}"}
    except Exception as exc:
        log.warning("kg_query failed: %s", exc)
        return {"error": "无法查询知识图谱"}


async def _exec_unified_search(args: dict) -> dict:
    try:
        result = await search_all(
            str(args["query"]),
            types=args.get("types"),
            size=int(args.get("size", 10)),
        )
        return result
    except Exception as exc:
        log.warning("unified_search failed: %s", exc)
        return {"error": "无法执行统一搜索"}


_EXECUTORS: dict = {
    "vector_search": _exec_vector_search,
    "kg_stats": _exec_kg_stats,
    "kg_query": _exec_kg_query,
    "unified_search": _exec_unified_search,
}


async def _run_tool(tc) -> dict:
    """Execute one tool call; returns a result dict (never raises)."""
    fn_name = tc.function.name
    try:
        fn_args = json.loads(tc.function.arguments or "{}")
    except json.JSONDecodeError:
        fn_args = {}
    executor = _EXECUTORS.get(fn_name)
    if executor is None:
        return {"error": f"未知工具: {fn_name}"}
    return await executor(fn_args)


# ── agent main ────────────────────────────────────────────────────────────────


async def stream_answer(
    query: str,
    top_k: int | None = None,
) -> AsyncIterator[dict]:
    """Async generator yielding SSE events.

    Events:
        {"event": "tool_call", "data": {"tool": "...", "status": "running"}}
        {"event": "sources",   "data": [...hits...]}   (only high-score hits)
        {"event": "delta",     "data": "..."}          (repeated)
        {"event": "done",      "data": "[DONE]"}
        {"event": "error",     "data": "..."}
    """
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": query},
    ]
    vector_hits: list[dict] = []

    # ── ReAct loop (max 2 rounds of tool calling) ─────────────────────────────
    for _round in range(2):
        try:
            msg = await llm.complete_with_tools(messages, TOOLS)
        except Exception as exc:
            log.exception("LLM tool-decision failed: %s", exc)
            yield {
                "event": "error",
                "data": "Unable to process your request right now.",
            }
            return

        tool_calls = getattr(msg, "tool_calls", None) or []

        if not tool_calls:
            # LLM chose to answer directly — surface collected sources, then
            # emit the already-completed content as a single delta.
            if vector_hits:
                yield {"event": "sources", "data": vector_hits}
            content = (getattr(msg, "content", None) or "").strip()
            if content:
                yield {"event": "delta", "data": content}
            yield {"event": "done", "data": "[DONE]"}
            return

        # ── yield tool_call progress events ───────────────────────────────────
        for tc in tool_calls:
            yield {
                "event": "tool_call",
                "data": {"tool": tc.function.name, "status": "running"},
            }

        # ── execute all tools concurrently ────────────────────────────────────
        results = await asyncio.gather(
            *[_run_tool(tc) for tc in tool_calls], return_exceptions=True
        )

        # ── append assistant turn + tool results to message history ───────────
        messages.append(
            {
                "role": "assistant",
                "content": getattr(msg, "content", None),
                "tool_calls": [
                    {
                        "id": tc.id or f"call_{i}",
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for i, tc in enumerate(tool_calls)
                ],
            }
        )

        for tc, result in zip(tool_calls, results):
            if isinstance(result, Exception):
                log.warning("tool %s raised: %s", tc.function.name, result)
                result = {"error": "工具调用失败"}

            # Accumulate high-score vector-search hits for the sources panel.
            if tc.function.name == "vector_search" and isinstance(result, dict):
                vector_hits.extend(result.get("hits", []))

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id or f"call_{tool_calls.index(tc)}",
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                }
            )

    # ── stream final answer after all tool rounds ─────────────────────────────
    if vector_hits:
        yield {"event": "sources", "data": vector_hits}

    try:
        async for delta in llm.stream(messages):
            if delta:
                yield {"event": "delta", "data": delta}
    except Exception as exc:
        log.exception("LLM final stream failed: %s", exc)
        yield {
            "event": "error",
            "data": "An internal error occurred while generating the response.",
        }
        return

    yield {"event": "done", "data": "[DONE]"}
