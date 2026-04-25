import logging

import httpx
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile, status

from app.core.config import settings
from app.core.deps import DB, CurrentUser
from app.schemas.files import BatchUploadResponse, FileUploadedResponse
from app.services.files import FileUploadError, upload_batch, upload_single

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/files", tags=["files"])


async def _wake_worker() -> None:
    """Fire-and-forget HTTP ping to resume a suspended Fly.io worker machine.

    See documents.py for the full explanation.  Empty WORKER_WAKE_URL = no-op.
    """
    url = settings.WORKER_WAKE_URL
    if not url:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.get(url)
    except Exception:
        log.debug("Worker wake-up ping to %s failed (non-fatal)", url)


def _dispatch_kg_pipeline(document_id: int) -> None:
    """Fire-and-forget KG extraction dispatch (US-048).

    Called AFTER `db.commit()` so a dispatched task never references a
    doc that the DB rolled back. Import is local to keep FastAPI cold-
    start light and to dodge an import loop with worker.tasks.

    Dispatch failures (Redis unreachable, etc.) are logged but do not
    bubble — the document is already persisted. Ops can re-trigger the
    pipeline via a future admin endpoint without re-uploading the file.
    """
    try:
        from app.worker.tasks import kg_pipeline

        kg_pipeline.delay(document_id)
    except Exception as exc:
        log.warning("KG pipeline dispatch failed for doc=%s: %s", document_id, exc)


@router.post(
    "/upload",
    response_model=FileUploadedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="单文件上传（最大 100 MB）",
)
async def upload_file(
    file: UploadFile = File(...),
    category_id: int | None = Form(None),
    db: DB = None,
    user: CurrentUser = None,
    background_tasks: BackgroundTasks = None,
):
    try:
        item = await upload_single(db, file, uploader_id=user.id, category_id=category_id)
        await db.commit()
    except FileUploadError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.reason)

    # Two-phase: commit first, then dispatch. If dispatch raises, the
    # document is still saved; ops can re-trigger the pipeline later.
    _dispatch_kg_pipeline(item.id)
    background_tasks.add_task(_wake_worker)
    return FileUploadedResponse.model_validate(item)


@router.post(
    "/upload/batch",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="批量上传（最大 500 MB 总量）",
)
async def upload_files_batch(
    files: list[UploadFile] = File(...),
    category_id: int | None = Form(None),
    db: DB = None,
    user: CurrentUser = None,
    background_tasks: BackgroundTasks = None,
):
    result = await upload_batch(db, files, uploader_id=user.id, category_id=category_id)
    # Batch path: commit already happened inside upload_batch; fan out
    # per uploaded item. Failures here are non-fatal (see helper).
    for uploaded in result.uploaded:
        _dispatch_kg_pipeline(uploaded.id)
    background_tasks.add_task(_wake_worker)
    return result
