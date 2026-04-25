from datetime import datetime

from pydantic import BaseModel

ALLOWED_EXTENSIONS = {
    "pdf",
    "docx",
    "doc",
    "pptx",
    "ppt",
    "xlsx",
    "xls",
    "txt",
    "md",
    "csv",
}
MAX_SINGLE_MB = 100
MAX_BATCH_MB = 500


class FileUploadedResponse(BaseModel):
    id: int
    name: str
    size: int
    mime_type: str | None
    file_type: str
    file_path: str | None
    uploader_id: int
    category_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BatchUploadResponse(BaseModel):
    uploaded: list[FileUploadedResponse]
    failed: list[dict]  # [{name, reason}]
    total_size: int
