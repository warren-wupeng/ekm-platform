"""Sharing records — create, list, revoke (soft), restore, and public access.

Revoke is soft: `DELETE /api/v1/sharing/{id}` sets `deleted_at` instead of
removing the row. The record stays in the DB for `RETENTION_DAYS` so the
owner can `POST /api/v1/sharing/{id}/restore` on it. After that the
Celery beat task `ekm.sharing.purge_expired` hard-deletes it.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import select

from app.core.deps import DB, CurrentUser
from app.models.sharing import SharingRecord
from app.schemas.sharing import (
    CreateShareRequest,
    PublicAccessResponse,
    ShareResponse,
)
from app.services.sharing import (
    RETENTION_DAYS,
    SharingError,
    create_share,
    resolve_public_token,
    restore_share,
    soft_delete_share,
)

router = APIRouter(prefix="/api/v1/sharing", tags=["sharing"])


def _build_response(record: SharingRecord, request: Request) -> ShareResponse:
    public_url: str | None = None
    if record.token:
        base = str(request.base_url).rstrip("/")
        public_url = f"{base}/api/v1/sharing/public/{record.token}"
    # Compute restore window remaining (rounded up so "0 days" only shows
    # on the exact expiry instant; UIs showing "X天后自动删除" want generous
    # rounding).
    restore_days_left: int | None = None
    if record.deleted_at is not None:
        elapsed = datetime.now(UTC) - record.deleted_at
        remaining = timedelta(days=RETENTION_DAYS) - elapsed
        restore_days_left = max(
            0, (remaining.days + (1 if remaining.seconds or remaining.microseconds else 0))
        )
    return ShareResponse(
        id=record.id,
        knowledge_item_id=record.knowledge_item_id,
        shared_by_id=record.shared_by_id,
        shared_to_user_id=record.shared_to_user_id,
        shared_to_department=record.shared_to_department,
        permission=record.permission.value,
        token=record.token,
        public_url=public_url,
        expires_at=record.expires_at,
        created_at=record.created_at,
        deleted_at=record.deleted_at,
        is_deleted=record.deleted_at is not None,
        restore_days_left=restore_days_left,
    )


async def _load_owned_share(db, share_id: int, user) -> SharingRecord:
    result = await db.execute(
        select(SharingRecord).where(
            SharingRecord.id == share_id,
            SharingRecord.shared_by_id == user.id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="分享记录不存在或无权操作",
        )
    return record


@router.post(
    "/",
    response_model=ShareResponse,
    status_code=status.HTTP_201_CREATED,
    summary="创建分享（用户/部门/公开链接）",
)
async def create(
    body: CreateShareRequest,
    request: Request,
    db: DB = None,
    user: CurrentUser = None,
):
    try:
        record = await create_share(db, body, user)
        await db.commit()
        return _build_response(record, request)
    except SharingError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND
            if e.code == "NOT_FOUND"
            else status.HTTP_400_BAD_REQUEST,
            detail={"code": e.code, "message": e.message},
        )


@router.get(
    "/",
    response_model=list[ShareResponse],
    summary="列出当前用户发出的分享（默认仅活跃记录）",
)
async def list_my_shares(
    request: Request,
    db: DB = None,
    user: CurrentUser = None,
    include_deleted: bool = Query(
        False,
        description="true 则连同已软删除记录一并返回；多数场景用默认 false",
    ),
):
    stmt = select(SharingRecord).where(SharingRecord.shared_by_id == user.id)
    if not include_deleted:
        stmt = stmt.where(SharingRecord.deleted_at.is_(None))
    stmt = stmt.order_by(SharingRecord.created_at.desc())
    result = await db.execute(stmt)
    records = result.scalars().all()
    return [_build_response(r, request) for r in records]


@router.get(
    "/trash",
    response_model=list[ShareResponse],
    summary="列出仍在恢复窗口内（30天）的已撤销分享",
)
async def list_trash(
    request: Request,
    db: DB = None,
    user: CurrentUser = None,
):
    # Explicit cutoff filter — belt & braces against rows that somehow
    # survived the purge task (e.g. beat outage). Hiding already-expired
    # records here avoids the UI offering a "Restore" button that will
    # then fail with RESTORE_WINDOW_EXPIRED.
    cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
    stmt = (
        select(SharingRecord)
        .where(
            SharingRecord.shared_by_id == user.id,
            SharingRecord.deleted_at.is_not(None),
            SharingRecord.deleted_at >= cutoff,
        )
        .order_by(SharingRecord.deleted_at.desc())
    )
    result = await db.execute(stmt)
    records = result.scalars().all()
    return [_build_response(r, request) for r in records]


@router.delete(
    "/{share_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="撤销分享（软删除，30天内可恢复）",
)
async def revoke(share_id: int, db: DB = None, user: CurrentUser = None):
    record = await _load_owned_share(db, share_id, user)
    await soft_delete_share(db, record)
    await db.commit()


@router.post(
    "/{share_id}/restore",
    response_model=ShareResponse,
    summary="恢复已撤销的分享（仅 30 天内有效）",
)
async def restore(
    share_id: int,
    request: Request,
    db: DB = None,
    user: CurrentUser = None,
):
    record = await _load_owned_share(db, share_id, user)
    try:
        await restore_share(db, record)
    except SharingError as e:
        # RESTORE_WINDOW_EXPIRED → 410 Gone (resource existed but is no
        # longer recoverable). Matches how we signal expired public links.
        raise HTTPException(
            status_code=status.HTTP_410_GONE
            if e.code == "RESTORE_WINDOW_EXPIRED"
            else status.HTTP_400_BAD_REQUEST,
            detail={"code": e.code, "message": e.message},
        )
    await db.commit()
    return _build_response(record, request)


@router.get(
    "/public/{token}",
    response_model=PublicAccessResponse,
    summary="通过公开链接 token 获取资源信息（无需登录）",
)
async def public_access(token: str, db: DB = None):
    try:
        record = await resolve_public_token(db, token)
    except SharingError as e:
        raise HTTPException(
            status_code=status.HTTP_410_GONE
            if e.code == "TOKEN_EXPIRED"
            else status.HTTP_404_NOT_FOUND,
            detail={"code": e.code, "message": e.message},
        )
    await db.refresh(record, ["knowledge_item"])
    return PublicAccessResponse(
        knowledge_item_id=record.knowledge_item_id,
        name=record.knowledge_item.name,
        permission=record.permission.value,
        expires_at=record.expires_at,
    )
