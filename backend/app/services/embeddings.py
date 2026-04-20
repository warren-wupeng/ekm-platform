"""Embedding helper — routes through LiteLLM via OpenRouter.

Uses a small, cheap model by default (openai/text-embedding-3-small, 1536-dim).
Override via EMBEDDING_MODEL / EMBEDDING_BASE_URL env vars.
"""
from __future__ import annotations

import logging
from typing import Iterable

import litellm

from app.core.config import settings


log = logging.getLogger(__name__)


class Embedder:
    def __init__(self):
        self.model = settings.EMBEDDING_MODEL
        self.dim = settings.EMBEDDING_DIM
        # Embedding goes through OpenRouter (AI Gateway only supports
        # chat completions, not /embeddings).
        self.api_base = settings.EMBEDDING_BASE_URL or None
        self.api_key = settings.EMBEDDING_API_KEY or settings.LLM_API_KEY or None

    def _kwargs(self) -> dict:
        kw = {"model": self.model}
        if self.api_base:
            kw["api_base"] = self.api_base
        if self.api_key:
            kw["api_key"] = self.api_key
        return kw

    def embed(self, texts: Iterable[str]) -> list[list[float]]:
        """Sync embed — used from Celery workers.

        Batched internally by LiteLLM; we send up to 64 per call to stay
        well under provider request limits.
        """
        batch = list(texts)
        if not batch:
            return []

        out: list[list[float]] = []
        CHUNK = 64
        for i in range(0, len(batch), CHUNK):
            window = batch[i : i + CHUNK]
            resp = litellm.embedding(input=window, **self._kwargs())
            out.extend([d["embedding"] for d in resp["data"]])
        return out


embedder = Embedder()
