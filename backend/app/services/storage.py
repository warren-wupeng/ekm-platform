"""File storage abstraction — S3 backend with local-disk fallback.

When ``settings.S3_BUCKET`` is set, files are stored in an S3-compatible
bucket (Fly Tigris, AWS S3, MinIO).  When empty **and APP_ENV is not
production/staging**, files fall back to ``settings.UPLOAD_DIR`` on the
local filesystem.  In non-dev environments an empty ``S3_BUCKET`` causes
a hard startup failure to prevent silent fallback bugs.

All public functions accept and return **storage keys** — opaque strings
like ``"abc123.pdf"`` that map 1-to-1 with ``KnowledgeItem.file_path``.
"""
from __future__ import annotations

import logging
from pathlib import Path

from app.core.config import settings

log = logging.getLogger(__name__)

# Max single-object download (bytes).  Prevents OOM on the 512 MB worker.
MAX_DOWNLOAD_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024  # matches upload cap


class StorageError(RuntimeError):
    """Raised on any storage-layer failure (wraps boto / filesystem errors)."""


# ---------------------------------------------------------------------------
# Fail-fast guard — catch missing S3 config in staging/prod at import time
# ---------------------------------------------------------------------------
_DEV_ENVS = {"development", "dev", "test", "testing"}

if not settings.S3_BUCKET and getattr(settings, "APP_ENV", "development").lower() not in _DEV_ENVS:
    raise StorageError(
        f"S3_BUCKET is empty but APP_ENV={getattr(settings, 'APP_ENV', '?')}. "
        "Set S3_BUCKET via Fly secrets or switch APP_ENV to 'development'."
    )


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
    """Store *content* under *key*.  Raises ``StorageError`` on failure."""
    if _use_s3():
        import botocore.exceptions
        try:
            _get_s3().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=content)
            log.debug("s3 upload: %s (%d bytes)", key, len(content))
        except (botocore.exceptions.ClientError, botocore.exceptions.BotoCoreError) as e:
            raise StorageError(f"S3 upload failed for key={key}: {e}") from e
    else:
        d = Path(settings.UPLOAD_DIR)
        d.mkdir(parents=True, exist_ok=True)
        (d / key).write_bytes(content)


def download(key: str) -> bytes:
    """Return the raw bytes for *key*.

    Raises ``FileNotFoundError`` when the key doesn't exist.
    Raises ``StorageError`` on size-cap breach or transport errors.
    """
    if _use_s3():
        import botocore.exceptions
        try:
            resp = _get_s3().get_object(Bucket=settings.S3_BUCKET, Key=key)
            size = resp.get("ContentLength", 0)
            if size > MAX_DOWNLOAD_BYTES:
                raise StorageError(
                    f"Object {key} is {size} bytes, exceeds "
                    f"MAX_DOWNLOAD_BYTES={MAX_DOWNLOAD_BYTES}"
                )
            return resp["Body"].read()
        except botocore.exceptions.ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise FileNotFoundError(key) from e
            raise StorageError(f"S3 download failed for key={key}: {e}") from e
        except botocore.exceptions.BotoCoreError as e:
            raise StorageError(f"S3 download failed for key={key}: {e}") from e
    else:
        p = Path(settings.UPLOAD_DIR) / key
        if not p.exists():
            raise FileNotFoundError(key)
        return p.read_bytes()


def delete(key: str) -> None:
    """Remove *key* from storage.  No-op if already absent."""
    if _use_s3():
        import botocore.exceptions
        try:
            _get_s3().delete_object(Bucket=settings.S3_BUCKET, Key=key)
            log.debug("s3 delete: %s", key)
        except (botocore.exceptions.ClientError, botocore.exceptions.BotoCoreError) as e:
            raise StorageError(f"S3 delete failed for key={key}: {e}") from e
    else:
        p = Path(settings.UPLOAD_DIR) / key
        p.unlink(missing_ok=True)
