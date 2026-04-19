"""Batch operations on knowledge items (US-055).

Three endpoints, all under `/api/v1/knowledge/batch`:

  POST /batch/move     move N items to a category (or out of any)
  POST /batch/delete   hard-delete N items
  POST /batch/share    share N items with the same target + permission

All three return HTTP 207 Multi-Status with a {succeeded, failed, batch_id}
body. Why 207 even on "all succeeded":

  - Clients parse one shape in one branch, not two shapes across 200/207.
  - 207 is semantically honest: every batch endpoint *could* have partial
    success, even if this particular call didn't.
  - Mirrors the existing `/files/upload/batch` contract — one less thing
    for the frontend to special-case.

Per-item RBAC lives in services/batch_ops.py. The router just maps
request → service call → response.
"""
from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, DB
from app.schemas.batch import (
    BatchDeleteRequest,
    BatchMoveRequest,
    BatchResponse,
    BatchShareRequest,
)
from app.services import batch_ops

router = APIRouter(
    prefix="/api/v1/knowledge/batch",
    tags=["knowledge-batch"],
)


@router.post(
    "/move",
    response_model=BatchResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="批量移动知识条目到目标分类",
)
async def batch_move(
    body: BatchMoveRequest, user: CurrentUser, db: DB,
) -> dict:
    result = await batch_ops.batch_move(
        db, user=user, ids=body.ids, category_id=body.category_id,
    )
    await db.commit()
    return result


@router.post(
    "/delete",
    response_model=BatchResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="批量删除知识条目（硬删除，需为拥有者或管理员）",
)
async def batch_delete(
    body: BatchDeleteRequest, user: CurrentUser, db: DB,
) -> dict:
    result = await batch_ops.batch_delete(db, user=user, ids=body.ids)
    await db.commit()
    return result


@router.post(
    "/share",
    response_model=BatchResponse,
    status_code=status.HTTP_207_MULTI_STATUS,
    summary="批量分享知识条目到同一目标（需为拥有者或管理员）",
)
async def batch_share(
    body: BatchShareRequest, user: CurrentUser, db: DB,
) -> dict:
    result = await batch_ops.batch_share(
        db,
        user=user,
        ids=body.ids,
        target=body.target,
        permission=body.permission,
        target_user_id=body.target_user_id,
        target_department=body.target_department,
        expires_hours=body.expires_hours,
    )
    await db.commit()
    return result
