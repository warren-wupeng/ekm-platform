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

from elasticsearch import AsyncElasticsearch, NotFoundError

from app.core.config import settings


log = logging.getLogger(__name__)

INDEX_CHUNKS = "ekm_chunks"
INDEX_ITEMS = "ekm_items"


# Default to IK; if the plugin isn't installed, falls back to `standard`.
_CJK_ANALYZER_INDEX = "ik_max_word"
_CJK_ANALYZER_SEARCH = "ik_smart"


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
            INDEX_CHUNKS, _chunk_mapping(cjk_index, cjk_search),
        )
        await self._create_if_missing(
            INDEX_ITEMS, _item_mapping(cjk_index, cjk_search),
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
        exists = await self.client.indices.exists(index=name)
        if exists:
            return
        await self.client.indices.create(index=name, body=body)
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
        self, q: str, *, size: int = 20, file_type: str | None = None,
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


es = ESClient()
