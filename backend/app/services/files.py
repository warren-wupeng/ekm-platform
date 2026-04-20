"""File upload service — stores files via the storage abstraction (S3 or local)."""
import asyncio
import mimetypes
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.knowledge import FileType, KnowledgeItem
from app.services import storage
from app.schemas.files import (
    ALLOWED_EXTENSIONS,
    MAX_BATCH_MB,
    MAX_SINGLE_MB,
    FileUploadedResponse,
    BatchUploadResponse,
)

MB = 1024 * 1024


def _ext(filename: str) -> str:
    return Path(filename).suffix.lstrip(".").lower()


def _file_type_from_ext(ext: str) -> FileType:
    if ext in {"pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv"}:
        return FileType.DOCUMENT
    if ext in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
        return FileType.IMAGE
    if ext in {"zip", "tar", "gz", "rar", "7z"}:
        return FileType.ARCHIVE
    if ext in {"mp3", "wav", "ogg", "flac"}:
        return FileType.AUDIO
    if ext in {"mp4", "mov", "avi", "mkv"}:
        return FileType.VIDEO
    return FileType.OTHER


class FileUploadError(Exception):
    def __init__(self, filename: str, reason: str):
        self.filename = filename
        self.reason = reason


async def _read_and_validate(file: UploadFile) -> bytes:
    ext = _ext(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise FileUploadError(file.filename or "", f"不支持的格式 .{ext}（支持：{', '.join(sorted(ALLOWED_EXTENSIONS))}）")

    content = await file.read()
    size_mb = len(content) / MB
    if size_mb > MAX_SINGLE_MB:
        raise FileUploadError(file.filename or "", f"文件超过单文件限制 {MAX_SINGLE_MB} MB（当前 {size_mb:.1f} MB）")

    return content


async def _save(content: bytes, original_name: str) -> str:
    """Write content to storage and return the storage key.

    Runs the (sync) boto3 call in a thread so we don't block the event loop.
    """
    ext = _ext(original_name)
    stem = uuid.uuid4().hex
    key = f"{stem}.{ext}" if ext else stem
    await asyncio.to_thread(storage.upload, content, key)
    return key


async def upload_single(
    db: AsyncSession,
    file: UploadFile,
    uploader_id: int,
    category_id: int | None = None,
) -> KnowledgeItem:
    content = await _read_and_validate(file)
    rel_path = await _save(content, file.filename or "upload")
    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    ext = _ext(file.filename or "")

    item = KnowledgeItem(
        name=file.filename or rel_path,
        file_path=rel_path,
        file_type=_file_type_from_ext(ext),
        mime_type=mime,
        size=len(content),
        uploader_id=uploader_id,
        category_id=category_id,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


async def upload_batch(
    db: AsyncSession,
    files: list[UploadFile],
    uploader_id: int,
    category_id: int | None = None,
) -> BatchUploadResponse:
    uploaded: list[FileUploadedResponse] = []
    failed: list[dict] = []
    total_size = 0

    for file in files:
        # Rolling batch size check
        if (total_size / MB) >= MAX_BATCH_MB:
            failed.append({"name": file.filename, "reason": f"批量上传总量超过 {MAX_BATCH_MB} MB 限制"})
            continue
        try:
            item = await upload_single(db, file, uploader_id, category_id)
            total_size += item.size
            uploaded.append(FileUploadedResponse.model_validate(item))
        except FileUploadError as e:
            failed.append({"name": e.filename, "reason": e.reason})

    await db.commit()
    return BatchUploadResponse(uploaded=uploaded, failed=failed, total_size=total_size)
