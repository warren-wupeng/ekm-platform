"""File storage abstraction — S3 backend with local-disk fallback.

When ``settings.S3_BUCKET`` is set, files are stored in an S3-compatible
bucket (Fly Tigris, AWS S3, MinIO).  When empty, files fall back to
``settings.UPLOAD_DIR`` on the local filesystem (dev / test only).

All public functions accept and return **storage keys** — opaque strings
like ``"abc123.pdf"`` that map 1-to-1 with ``KnowledgeItem.file_path``.
"""
from __future__ import annotations

import logging
from pathlib import Path

from app.core.config import settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# S3 client (lazy singleton)
# ---------------------------------------------------------------------------
_s3 = None


def _get_s3():
    global _s3
    if _s3 is None:
        import boto3
        _s3 = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            region_name=settings.S3_REGION,
        )
    return _s3


def _use_s3() -> bool:
    return bool(settings.S3_BUCKET)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def upload(content: bytes, key: str) -> None:
    """Store *content* under *key*."""
    if _use_s3():
        _get_s3().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content)
        log.debug("s3 upload: %s (%d bytes)", key, len(content))
    else:
        d = Path(settings.UPLOAD_DIR)
        d.mkdir(parents=True, exist_ok=True)
        (d / key).write_bytes(content)


def download(key: str) -> bytes:
    """Return the raw bytes for *key*.  Raises ``FileNotFoundError``."""
    if _use_s3():
        import botocore.exceptions
        try:
            resp = _get_s3().get_object(Bucket=settings.S3_BUCKET, Key=key)
            return resp["Body"].read()
        except botocore.exceptions.ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise FileNotFoundError(key) from e
            raise
    else:
        p = Path(settings.UPLOAD_DIR) / key
        if not p.exists():
            raise FileNotFoundError(key)
        return p.read_bytes()


def delete(key: str) -> None:
    """Remove *key* from storage.  No-op if already absent."""
    if _use_s3():
        _get_s3().delete_object(Bucket=settings.S3_BUCKET, Key=key)
        log.debug("s3 delete: %s", key)
    else:
        p = Path(settings.UPLOAD_DIR) / key
        p.unlink(missing_ok=True)
