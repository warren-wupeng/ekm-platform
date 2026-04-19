"""Unified search aggregator (#42 / US-075).

One entry point, fans out to the per-index searches in `es_client`, merges
results into the grouped response shape the frontend expects:

    {
        query:  str,
        total:  int,               # grand total across all requested types
        results: {
            documents: { total, hits: [...] },
            posts:     { total, hits: [...] },
            tags:      { total, hits: [...] },
        }
    }

Design choices:

- "documents" bucket unifies `ekm_items` (metadata: name/description) AND
  `ekm_chunks` (body content). Hits from both indices are merged and
  deduplicated by `document_id`, keeping the higher-scoring hit. A chunk
  hit carries `chunk_index` + highlighted passage so the UI can jump to it;
  an item hit carries `name` + `description` highlights.

- "posts" bucket unifies `ekm_posts` (title+body) AND `ekm_replies`
  (comment content). Reply hits include `post_id` so the UI can link back
  to the thread.

- "tags" bucket covers both Tags and Categories (both live in `ekm_tags`
  with a `kind` discriminator).

- ES failures on any single index are logged + skipped, not fatal — a
  degraded search (e.g. posts index missing) is still better than a 500.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable

from app.services.es_client import es


log = logging.getLogger(__name__)


# Types the frontend can request via ?types=documents,posts,tags
ALL_TYPES = ("documents", "posts", "tags")


async def search_all(
    q: str,
    *,
    types: Iterable[str] | None = None,
    size: int = 20,
) -> dict[str, Any]:
    """Run unified search across the requested content buckets."""
    requested = _normalize_types(types)

    # Fan out concurrently — each bucket is an independent ES query.
    jobs: dict[str, asyncio.Task[dict[str, Any]]] = {}
    if "documents" in requested:
        jobs["documents"] = asyncio.create_task(_search_documents(q, size=size))
    if "posts" in requested:
        jobs["posts"] = asyncio.create_task(_search_posts(q, size=size))
    if "tags" in requested:
        jobs["tags"] = asyncio.create_task(_search_tags(q, size=size))

    results: dict[str, dict[str, Any]] = {}
    for bucket, task in jobs.items():
        try:
            results[bucket] = await task
        except Exception as exc:  # pragma: no cover — ES live path
            log.warning("unified-search bucket=%s failed: %s", bucket, exc)
            results[bucket] = {"total": 0, "hits": []}

    grand_total = sum(r.get("total", 0) for r in results.values())
    return {"query": q, "total": grand_total, "results": results}


def _normalize_types(types: Iterable[str] | None) -> set[str]:
    if not types:
        return set(ALL_TYPES)
    requested = {t.strip().lower() for t in types if t and t.strip()}
    # Silently drop unknown types rather than 400 — keeps the API forward-
    # compatible with future buckets the frontend may probe for.
    return requested & set(ALL_TYPES) or set(ALL_TYPES)


async def _search_documents(q: str, *, size: int) -> dict[str, Any]:
    """Merge item-level + chunk-level hits into a single documents bucket.

    The UI expects a flat list of document hits; chunk matches are surfaced
    inline as a `matched_chunks` array on the parent document entry. We
    dedupe by `document_id` — if both the item and a chunk matched, we take
    the max score and attach the chunk excerpts to the item hit.
    """
    items = await es.search_items(q, size=size)
    chunks = await es.search_chunks(q, size=size)

    by_doc: dict[int, dict[str, Any]] = {}

    for it in items:
        doc_id = int(it["id"])
        by_doc[doc_id] = {
            "document_id": doc_id,
            "score": it.get("score", 0.0),
            "name": it["source"].get("name"),
            "description": it["source"].get("description"),
            "file_type": it["source"].get("file_type"),
            "highlight": it.get("highlight", {}),
            "matched_chunks": [],
        }

    for ch in chunks:
        doc_id = int(ch["document_id"])
        entry = by_doc.get(doc_id)
        excerpt = {
            "chunk_index": ch["chunk_index"],
            "score": ch.get("score", 0.0),
            "content": ch.get("content"),
            "highlight": ch.get("highlight", {}),
        }
        if entry is None:
            by_doc[doc_id] = {
                "document_id": doc_id,
                "score": ch.get("score", 0.0),
                "name": None,
                "description": None,
                "file_type": None,
                "highlight": {},
                "matched_chunks": [excerpt],
            }
        else:
            entry["matched_chunks"].append(excerpt)
            entry["score"] = max(entry["score"], ch.get("score", 0.0))

    merged = sorted(by_doc.values(), key=lambda r: r["score"], reverse=True)
    # Cap to `size` after merging — we over-fetched per index, so trim now.
    merged = merged[:size]
    return {"total": len(merged), "hits": merged}


async def _search_posts(q: str, *, size: int) -> dict[str, Any]:
    """Merge post + reply hits. Reply hits link back to their parent post."""
    posts = await es.search_posts(q, size=size)
    replies = await es.search_replies(q, size=size)

    hits: list[dict[str, Any]] = []
    for p in posts["hits"]:
        src = p["source"]
        hits.append({
            "kind": "post",
            "post_id": int(src.get("id", p["id"])),
            "title": src.get("title"),
            "snippet": _first_highlight(p.get("highlight", {}), ("title", "body"))
                       or _truncate(src.get("body")),
            "score": p["score"],
            "author_id": src.get("author_id"),
            "created_at": src.get("created_at"),
        })
    for r in replies["hits"]:
        src = r["source"]
        hits.append({
            "kind": "reply",
            "reply_id": int(src.get("id", r["id"])),
            "post_id": src.get("post_id"),
            "snippet": _first_highlight(r.get("highlight", {}), ("content",))
                       or _truncate(src.get("content")),
            "score": r["score"],
            "author_id": src.get("author_id"),
            "created_at": src.get("created_at"),
        })
    hits.sort(key=lambda h: h["score"], reverse=True)
    hits = hits[:size]
    return {"total": posts["total"] + replies["total"], "hits": hits}


async def _search_tags(q: str, *, size: int) -> dict[str, Any]:
    raw = await es.search_tags(q, size=size)
    hits = [
        {
            "kind": h["source"].get("kind", "tag"),
            "id": int(h["source"].get("id", h["id"])),
            "name": h["source"].get("name"),
            "description": h["source"].get("description"),
            "slug": h["source"].get("slug"),
            "color": h["source"].get("color"),
            "usage_count": h["source"].get("usage_count", 0),
            "score": h["score"],
            "highlight": h.get("highlight", {}),
        }
        for h in raw["hits"]
    ]
    return {"total": raw["total"], "hits": hits}


def _first_highlight(highlight: dict[str, Any], fields: tuple[str, ...]) -> str | None:
    for f in fields:
        frags = highlight.get(f)
        if frags:
            return frags[0]
    return None


def _truncate(s: str | None, n: int = 200) -> str | None:
    if not s:
        return None
    s = s.replace("\n", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"
