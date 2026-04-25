"""Elasticsearch client + index management.

Indexes:
  ekm_chunks  — one doc per DocumentChunk (for semantic search UI)
  ekm_items   — one doc per KnowledgeItem (for file-list search)

Analyzer strategy (#21):
  - English text: standard analyzer (good enough)
  - CJK text: ik_max_word at index time, ik_smart at query time
  - IK plugin must be installed in the ES image; if missing, we fall back
    to the built-in `smartcn`-style standard analyzer so the stack still
    boots. A startup warning is logged so ops notices.
"""

from __future__ import annotations

import logging
from typing import Any

from elasticsearch import ApiError, AsyncElasticsearch, BadRequestError, NotFoundError

from app.core.config import settings

log = logging.getLogger(__name__)

INDEX_CHUNKS = "ekm_chunks"
INDEX_ITEMS = "ekm_items"
# Unified full-text search (#42 / US-075). Three additional indices that
# back the cross-type search endpoint. Mappings share the same IK-or-standard
# analyzer detection as ekm_items so CJK queries tokenize consistently.
INDEX_POSTS = "ekm_posts"
INDEX_REPLIES = "ekm_replies"
INDEX_TAGS = "ekm_tags"


# Default to IK; if the plugin isn't installed, falls back to `standard`.
_CJK_ANALYZER_INDEX = "ik_max_word"
_CJK_ANALYZER_SEARCH = "ik_smart"


def _is_already_exists(exc: ApiError) -> bool:
    """Return True if this ES error is a benign 'index already exists' race.

    ES returns HTTP 400 with error.type = "resource_already_exists_exception"
    when a concurrent create lost the race. The error body shape is stable
    across the 8.x client; fall back to the stringified message if the body
    isn't the dict we expect (some transport layers wrap differently).
    """
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and err.get("type") == "resource_already_exists_exception":
            return True
    # Last-resort substring match. Not pretty, but indices.create's API
    # contract has been stable on this string since ES 5.
    return "resource_already_exists_exception" in str(exc)


def _chunk_mapping(cjk_analyzer_index: str, cjk_analyzer_search: str) -> dict[str, Any]:
    return {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 0,
            "analysis": {
                "analyzer": {
                    "ekm_cjk_index": {"type": "custom", "tokenizer": cjk_analyzer_index}
                    if cjk_analyzer_index != "standard"
                    else {"type": "standard"},
                    "ekm_cjk_search": {"type": "custom", "tokenizer": cjk_analyzer_search}
                    if cjk_analyzer_search != "standard"
                    else {"type": "standard"},
                }
            },
        },
        "mappings": {
            "properties": {
                "document_id": {"type": "long"},
                "chunk_index": {"type": "integer"},
                "content": {
                    "type": "text",
                    "analyzer": "ekm_cjk_index",
                    "search_analyzer": "ekm_cjk_search",
                },
                "created_at": {"type": "date"},
            }
        },
    }


def _item_mapping(cjk_analyzer_index: str, cjk_analyzer_search: str) -> dict[str, Any]:
    base = _chunk_mapping(cjk_analyzer_index, cjk_analyzer_search)
    base["mappings"]["properties"] = {
        "id": {"type": "long"},
        "name": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
            "fields": {"keyword": {"type": "keyword"}},
        },
        "description": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
        },
        "file_type": {"type": "keyword"},
        "mime_type": {"type": "keyword"},
        "uploader_id": {"type": "long"},
        "category_id": {"type": "long"},
        "tags": {"type": "keyword"},
        "created_at": {"type": "date"},
    }
    return base


def _post_mapping(cjk_analyzer_index: str, cjk_analyzer_search: str) -> dict[str, Any]:
    """Index one doc per Post. Replies live in their own index (see below)."""
    base = _chunk_mapping(cjk_analyzer_index, cjk_analyzer_search)
    base["mappings"]["properties"] = {
        "id": {"type": "long"},
        "title": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
            "fields": {"keyword": {"type": "keyword"}},
        },
        "body": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
        },
        "author_id": {"type": "long"},
        "reply_count": {"type": "integer"},
        "created_at": {"type": "date"},
    }
    return base


def _reply_mapping(cjk_analyzer_index: str, cjk_analyzer_search: str) -> dict[str, Any]:
    """One doc per Reply. Separate index keeps post mapping small and lets
    the unified-search UI show *which reply* matched (not just the post)."""
    base = _chunk_mapping(cjk_analyzer_index, cjk_analyzer_search)
    base["mappings"]["properties"] = {
        "id": {"type": "long"},
        "post_id": {"type": "long"},
        "parent_reply_id": {"type": "long"},
        "content": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
        },
        "author_id": {"type": "long"},
        "is_deleted": {"type": "boolean"},
        "created_at": {"type": "date"},
    }
    return base


def _tag_mapping(cjk_analyzer_index: str, cjk_analyzer_search: str) -> dict[str, Any]:
    """Shared mapping for Tags and Categories, discriminated by `kind`.

    Merging them keeps the unified-search aggregation flat (one ES query,
    one result bucket) — the UI distinguishes them via the `kind` field if
    it cares."""
    base = _chunk_mapping(cjk_analyzer_index, cjk_analyzer_search)
    base["mappings"]["properties"] = {
        "id": {"type": "long"},
        "kind": {"type": "keyword"},  # "tag" | "category"
        "name": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
            "fields": {"keyword": {"type": "keyword"}},
        },
        "description": {
            "type": "text",
            "analyzer": "ekm_cjk_index",
            "search_analyzer": "ekm_cjk_search",
        },
        "slug": {"type": "keyword"},
        "color": {"type": "keyword"},
        "usage_count": {"type": "integer"},
    }
    return base


class ESClient:
    def __init__(self, url: str | None = None):
        self.url = url or settings.ELASTICSEARCH_URL
        self._client: AsyncElasticsearch | None = None
        self._cjk_index = _CJK_ANALYZER_INDEX
        self._cjk_search = _CJK_ANALYZER_SEARCH

    @property
    def client(self) -> AsyncElasticsearch:
        if self._client is None:
            self._client = AsyncElasticsearch(self.url, request_timeout=15)
        return self._client

    async def close(self):
        if self._client is not None:
            await self._client.close()
            self._client = None

    async def ensure_indexes(self):
        """Idempotent index bootstrap. Called on app startup.

        Tries IK analyzers first; on failure (plugin missing) falls back to
        `standard` and logs a warning — the app still boots, just without
        Chinese tokenization.
        """
        cjk_index, cjk_search = await self._detect_cjk_analyzers()
        await self._create_if_missing(
            INDEX_CHUNKS,
            _chunk_mapping(cjk_index, cjk_search),
        )
        await self._create_if_missing(
            INDEX_ITEMS,
            _item_mapping(cjk_index, cjk_search),
        )
        # Unified search (#42) indices. Added here so a single ensure_indexes()
        # call on startup bootstraps everything; no separate migration step.
        await self._create_if_missing(
            INDEX_POSTS,
            _post_mapping(cjk_index, cjk_search),
        )
        await self._create_if_missing(
            INDEX_REPLIES,
            _reply_mapping(cjk_index, cjk_search),
        )
        await self._create_if_missing(
            INDEX_TAGS,
            _tag_mapping(cjk_index, cjk_search),
        )

    async def _detect_cjk_analyzers(self) -> tuple[str, str]:
        """Probe for IK plugin; fall back to standard if not present."""
        try:
            await self.client.indices.analyze(
                body={"analyzer": "ik_max_word", "text": "知识管理"},
            )
            return "ik_max_word", "ik_smart"
        except Exception as e:  # pragma: no cover — depends on live ES
            log.warning("IK analyzer unavailable (%s); falling back to standard", e)
            self._cjk_index = "standard"
            self._cjk_search = "standard"
            return "standard", "standard"

    async def _create_if_missing(self, name: str, body: dict[str, Any]):
        # The exists+create pair is TOCTOU-racy: when multiple workers
        # start simultaneously (compose / fly boot), two can both see
        # "not exists" and then both call create(), and the loser gets
        # a 400 `resource_already_exists_exception`. Elasticsearch's
        # create is not itself idempotent, so we handle that specific
        # error as success — any other BadRequestError (e.g. mapping
        # conflict) still bubbles.
        exists = await self.client.indices.exists(index=name)
        if exists:
            return
        try:
            await self.client.indices.create(index=name, body=body)
        except BadRequestError as exc:
            if _is_already_exists(exc):
                log.debug("ES index %s created concurrently by another worker", name)
                return
            raise
        except ApiError as exc:
            # Some client versions surface this under the generic ApiError
            # rather than BadRequestError. Belt-and-braces.
            if _is_already_exists(exc):
                log.debug("ES index %s created concurrently by another worker", name)
                return
            raise
        log.info("created ES index: %s", name)

    # ── write path ────────────────────────────────────────────────────

    async def index_chunk(self, *, doc_id: int, chunk_index: int, content: str):
        composite = f"{doc_id}:{chunk_index}"
        await self.client.index(
            index=INDEX_CHUNKS,
            id=composite,
            document={
                "document_id": doc_id,
                "chunk_index": chunk_index,
                "content": content,
            },
        )

    async def index_item(self, *, item_id: int, body: dict[str, Any]):
        await self.client.index(index=INDEX_ITEMS, id=str(item_id), document=body)

    # ── unified search write path (#42) ───────────────────────────────
    # All these are "best-effort" in the sense that callers (router layer)
    # should log+swallow failures: the primary DB write is authoritative,
    # ES is a secondary index.

    async def index_post(self, *, post_id: int, body: dict[str, Any]):
        await self.client.index(index=INDEX_POSTS, id=str(post_id), document=body)

    async def delete_post(self, post_id: int):
        try:
            await self.client.delete(index=INDEX_POSTS, id=str(post_id))
        except NotFoundError:
            pass
        # Cascade: drop any replies tied to this post so deleted threads
        # don't haunt unified search results.
        try:
            await self.client.delete_by_query(
                index=INDEX_REPLIES,
                body={"query": {"term": {"post_id": post_id}}},
                refresh=True,
            )
        except NotFoundError:
            pass

    async def index_reply(self, *, reply_id: int, body: dict[str, Any]):
        await self.client.index(index=INDEX_REPLIES, id=str(reply_id), document=body)

    async def delete_reply(self, reply_id: int):
        try:
            await self.client.delete(index=INDEX_REPLIES, id=str(reply_id))
        except NotFoundError:
            pass

    async def index_tag(self, *, tag_id: int, body: dict[str, Any]):
        # Tags live alongside categories — `kind` discriminates. Doc id
        # uses a namespaced scheme to avoid collisions.
        composite = f"{body.get('kind', 'tag')}:{tag_id}"
        await self.client.index(index=INDEX_TAGS, id=composite, document=body)

    async def delete_tag(self, *, tag_id: int, kind: str = "tag"):
        composite = f"{kind}:{tag_id}"
        try:
            await self.client.delete(index=INDEX_TAGS, id=composite)
        except NotFoundError:
            pass

    async def delete_document(self, doc_id: int):
        """Remove all chunks + item doc for a document (called on doc delete)."""
        try:
            await self.client.delete_by_query(
                index=INDEX_CHUNKS,
                body={"query": {"term": {"document_id": doc_id}}},
                refresh=True,
            )
        except NotFoundError:
            pass
        try:
            await self.client.delete(index=INDEX_ITEMS, id=str(doc_id))
        except NotFoundError:
            pass

    # ── read path ─────────────────────────────────────────────────────

    async def search_items(
        self,
        q: str,
        *,
        size: int = 20,
        file_type: str | None = None,
    ) -> list[dict[str, Any]]:
        must: list[dict[str, Any]] = [
            {"multi_match": {"query": q, "fields": ["name^3", "description"]}}
        ]
        filters: list[dict[str, Any]] = []
        if file_type:
            filters.append({"term": {"file_type": file_type}})

        resp = await self.client.search(
            index=INDEX_ITEMS,
            body={
                "size": size,
                "query": {"bool": {"must": must, "filter": filters}},
                "highlight": {"fields": {"name": {}, "description": {}}},
            },
        )
        return [
            {
                "id": int(hit["_id"]),
                "score": hit["_score"],
                "source": hit["_source"],
                "highlight": hit.get("highlight", {}),
            }
            for hit in resp["hits"]["hits"]
        ]

    async def search_chunks(self, q: str, *, size: int = 10) -> list[dict[str, Any]]:
        resp = await self.client.search(
            index=INDEX_CHUNKS,
            body={
                "size": size,
                "query": {"match": {"content": q}},
                "highlight": {"fields": {"content": {"fragment_size": 200}}},
            },
        )
        return [
            {
                "document_id": hit["_source"]["document_id"],
                "chunk_index": hit["_source"]["chunk_index"],
                "score": hit["_score"],
                "content": hit["_source"]["content"],
                "highlight": hit.get("highlight", {}),
            }
            for hit in resp["hits"]["hits"]
        ]

    # ── unified search read path (#42) ────────────────────────────────
    async def search_posts(self, q: str, *, size: int = 20) -> dict[str, Any]:
        resp = await self.client.search(
            index=INDEX_POSTS,
            body={
                "size": size,
                "query": {
                    "multi_match": {
                        "query": q,
                        "fields": ["title^3", "body"],
                    }
                },
                "highlight": {
                    "fields": {
                        "title": {},
                        "body": {"fragment_size": 160},
                    },
                },
            },
        )
        return _unpack_hits(resp, id_field="id")

    async def search_replies(self, q: str, *, size: int = 20) -> dict[str, Any]:
        resp = await self.client.search(
            index=INDEX_REPLIES,
            body={
                "size": size,
                "query": {
                    "bool": {
                        "must": [{"match": {"content": q}}],
                        # Exclude tombstoned replies — their content is empty
                        # anyway, but skipping them cuts down on noise.
                        "filter": [{"term": {"is_deleted": False}}],
                    }
                },
                "highlight": {"fields": {"content": {"fragment_size": 160}}},
            },
        )
        return _unpack_hits(resp, id_field="id")

    async def search_tags(self, q: str, *, size: int = 20) -> dict[str, Any]:
        resp = await self.client.search(
            index=INDEX_TAGS,
            body={
                "size": size,
                "query": {
                    "multi_match": {
                        "query": q,
                        "fields": ["name^3", "description"],
                    }
                },
                "highlight": {"fields": {"name": {}, "description": {}}},
            },
        )
        return _unpack_hits(resp, id_field="id")


def _unpack_hits(resp: dict[str, Any], *, id_field: str = "id") -> dict[str, Any]:
    """Shared shape for post/reply/tag search — returns {total, hits: [...]}."""
    hits = resp.get("hits", {})
    total = hits.get("total", {})
    total_n = total.get("value") if isinstance(total, dict) else int(total or 0)
    return {
        "total": int(total_n or 0),
        "hits": [
            {
                "id": hit["_source"].get(id_field, hit["_id"]),
                "score": hit["_score"],
                "source": hit["_source"],
                "highlight": hit.get("highlight", {}),
            }
            for hit in hits.get("hits", [])
        ],
    }


es = ESClient()
