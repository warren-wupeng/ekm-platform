"""Embedding helper — calls OpenAI directly (not via AI Gateway).

AI Gateway only supports /chat/completions, not /embeddings.
OpenRouter blocks OpenAI embedding proxy (403 ToS violation).
So we call OpenAI directly with a dedicated key.

Uses text-embedding-3-small (1536-dim) by default.
Override via EMBEDDING_MODEL / EMBEDDING_API_KEY env vars.
"""
from __future__ import annotations

import logging
from typing import Iterable

import httpx
from openai import OpenAI

from app.core.config import settings


log = logging.getLogger(__name__)

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = settings.EMBEDDING_API_KEY or settings.LLM_API_KEY
        _client = OpenAI(
            api_key=api_key,
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
        )
    return _client


class Embedder:
    def __init__(self):
        self.model = settings.EMBEDDING_MODEL
        self.dim = settings.EMBEDDING_DIM

    def embed(self, texts: Iterable[str]) -> list[list[float]]:
        """Sync embed — used from Celery workers.

        Batched in chunks of 64 to stay well under provider request limits.
        """
        batch = list(texts)
        if not batch:
            return []

        client = _get_client()
        out: list[list[float]] = []
        CHUNK = 64
        for i in range(0, len(batch), CHUNK):
            window = batch[i : i + CHUNK]
            resp = client.embeddings.create(model=self.model, input=window)
            out.extend([d.embedding for d in resp.data])
        return out


embedder = Embedder()
