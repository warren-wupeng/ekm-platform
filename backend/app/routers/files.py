from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from typing import Optional

from app.core.deps import CurrentUser, DB
from app.schemas.files import BatchUploadResponse, FileUploadedResponse
from app.services.files import FileUploadError, upload_batch, upload_single

router = APIRouter(prefix="/api/v1/files", tags=["files"])


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
        return FileUploadedResponse.model_validate(item)
    except FileUploadError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.reason)


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
    return await upload_batch(db, files, uploader_id=user.id, category_id=category_id)
