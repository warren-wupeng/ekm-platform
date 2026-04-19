import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from typing import Optional

from app.core.deps import CurrentUser, DB
from app.schemas.files import BatchUploadResponse, FileUploadedResponse
from app.services.files import FileUploadError, upload_batch, upload_single

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/files", tags=["files"])


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
    except Exception as exc:  # noqa: BLE001
        log.warning("KG pipeline dispatch failed for doc=%s: %s", document_id, exc)


@router.post(
    "/upload",
    response_model=FileUploadedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="单文件上传（最大 100 MB）",
)
async def upload_file(
    file: UploadFile = File(...),
    category_id: Optional[int] = Form(None),
    db: DB = None,
    user: CurrentUser = None,
):
    try:
        item = await upload_single(db, file, uploader_id=user.id, category_id=category_id)
        await db.commit()
    except FileUploadError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.reason)

    # Two-phase: commit first, then dispatch. If dispatch raises, the
    # document is still saved; ops can re-trigger the pipeline later.
    _dispatch_kg_pipeline(item.id)
    return FileUploadedResponse.model_validate(item)


@router.post(
    "/upload/batch",
    response_model=BatchUploadResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="批量上传（最大 500 MB 总量）",
)
async def upload_files_batch(
    files: list[UploadFile] = File(...),
    category_id: Optional[int] = Form(None),
    db: DB = None,
    user: CurrentUser = None,
):
    result = await upload_batch(db, files, uploader_id=user.id, category_id=category_id)
    # Batch path: commit already happened inside upload_batch; fan out
    # per uploaded item. Failures here are non-fatal (see helper).
    for uploaded in result.uploaded:
        _dispatch_kg_pipeline(uploaded.id)
    return result
