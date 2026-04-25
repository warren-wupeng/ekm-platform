"""Request + response shapes for batch knowledge-item operations."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator

from app.schemas.sharing import PermissionLevel, ShareTarget

# Upper bound per call. Above this the client should paginate — mostly
# to keep a single 207 response and its audit rows under a reasonable
# size. Picked 500 as a round number; tune later if needed.
MAX_BATCH_SIZE = 500


class _BaseBatchIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=MAX_BATCH_SIZE)


class BatchMoveRequest(_BaseBatchIn):
    category_id: int | None = Field(
        default=None,
        description="Destination category. null moves items out of any category.",
    )


class BatchDeleteRequest(_BaseBatchIn):
    pass


class BatchShareRequest(_BaseBatchIn):
    target: ShareTarget
    permission: PermissionLevel = PermissionLevel.VIEW
    target_user_id: int | None = None
    target_department: str | None = None
    expires_hours: int | None = 72

    @model_validator(mode="after")
    def _check_target_fields(self):
        # Mirrors CreateShareRequest — we validate up front so a bad
        # request doesn't get halfway through the loop before failing.
        if self.target == ShareTarget.USER and not self.target_user_id:
            raise ValueError("target_user_id required when target=user")
        if self.target == ShareTarget.DEPARTMENT and not self.target_department:
            raise ValueError("target_department required when target=department")
        return self


class FailedItem(BaseModel):
    id: int
    reason: str


class BatchResponse(BaseModel):
    """Response body for all three batch endpoints.

    Returned with HTTP 207 Multi-Status regardless of whether any item
    actually failed — the caller's treatment shouldn't flip between 200
    and 207 based on run-time data, because frontends would end up
    parsing one shape in two branches.
    """

    batch_id: str
    succeeded: list[dict]  # op-specific; see services/batch_ops.py
    failed: list[FailedItem]
