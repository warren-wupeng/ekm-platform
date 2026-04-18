"""Apache Tika REST client.

We run Tika as a sidecar service (see docker-compose.yml). The REST API is
simpler and more stable than the Python `tika` package's JVM-bridge mode,
so we speak HTTP directly.

Endpoints used:
    PUT /tika     — returns plain text extraction
    PUT /meta     — returns metadata as JSON
    PUT /rmeta/text — combined (one upload, returns both)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings


class TikaError(RuntimeError):
    pass


class TikaClient:
    def __init__(self, base_url: str | None = None, timeout: float = 120.0):
        self.base_url = (base_url or settings.TIKA_URL).rstrip("/")
        self.timeout = timeout

    async def extract(self, file_path: str | Path) -> tuple[str, dict[str, Any]]:
        """Extract text + metadata in a single round-trip via /rmeta/text.

        Returns (text, metadata_dict). Raises TikaError on non-2xx.
        """
        p = Path(file_path)
        if not p.exists():
            raise TikaError(f"file not found: {p}")

        # /rmeta/text returns a JSON array of dicts; for single-doc upload
        # there's one element whose X-TIKA:content holds the text.
        url = f"{self.base_url}/rmeta/text"
        headers = {"Accept": "application/json"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            with p.open("rb") as fh:
                resp = await client.put(url, content=fh.read(), headers=headers)

        if resp.status_code >= 400:
            raise TikaError(f"tika {resp.status_code}: {resp.text[:500]}")

        try:
            payload = resp.json()
        except json.JSONDecodeError as e:
            raise TikaError(f"tika returned non-JSON: {e}") from e

        if not isinstance(payload, list) or not payload:
            raise TikaError("tika returned empty payload")

        meta = payload[0]
        text = meta.pop("X-TIKA:content", "") or ""
        return text.strip(), meta


tika = TikaClient()
