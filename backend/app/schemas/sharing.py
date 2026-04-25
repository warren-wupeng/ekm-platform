from datetime import datetime
from enum import Enum

from pydantic import BaseModel, model_validator


class PermissionLevel(str, Enum):
    VIEW = "view"
    DOWNLOAD = "download"
    EDIT = "edit"


class ShareTarget(str, Enum):
    USER = "user"
    DEPARTMENT = "department"
    PUBLIC = "public"  # shareable link, no auth required


class CreateShareRequest(BaseModel):
    knowledge_item_id: int
    target: ShareTarget
    permission: PermissionLevel = PermissionLevel.VIEW
    # exactly one of these must be set based on target
    target_user_id: int | None = None
    target_department: str | None = None
    # public link options
    expires_hours: int | None = 72  # None → no expiry

    @model_validator(mode="after")
    def check_target_fields(self):
        if self.target == ShareTarget.USER and not self.target_user_id:
            raise ValueError("target_user_id required when target=user")
        if self.target == ShareTarget.DEPARTMENT and not self.target_department:
            raise ValueError("target_department required when target=department")
        return self


class ShareResponse(BaseModel):
    id: int
    knowledge_item_id: int
    shared_by_id: int
    shared_to_user_id: int | None
    shared_to_department: str | None
    permission: str
    token: str | None  # present for public shares
    public_url: str | None  # constructed by router
    expires_at: datetime | None
    created_at: datetime
    # Soft-delete metadata — `is_deleted` is redundant with `deleted_at`
    # but cheap, and saves the client a null-check when it only wants to
    # render status pills.
    deleted_at: datetime | None = None
    is_deleted: bool = False
    # Present only on trash listings; days remaining before auto-purge.
    restore_days_left: int | None = None

    model_config = {"from_attributes": True}


class PublicAccessResponse(BaseModel):
    knowledge_item_id: int
    name: str
    permission: str
    expires_at: datetime | None
