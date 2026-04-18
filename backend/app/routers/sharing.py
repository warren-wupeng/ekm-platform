from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.sharing import SharingRecord
from app.schemas.sharing import (
    CreateShareRequest,
    PublicAccessResponse,
    ShareResponse,
)
from app.services.sharing import SharingError, create_share, resolve_public_token

router = APIRouter(prefix="/api/v1/sharing", tags=["sharing"])


def _build_response(record: SharingRecord, request: Request) -> ShareResponse:
    public_url: str | None = None
    if record.token:
        base = str(request.base_url).rstrip("/")
        public_url = f"{base}/api/v1/sharing/public/{record.token}"
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
    )


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
            status_code=status.HTTP_404_NOT_FOUND if e.code == "NOT_FOUND" else status.HTTP_400_BAD_REQUEST,
            detail={"code": e.code, "message": e.message},
        )


@router.get(
    "/",
    response_model=list[ShareResponse],
    summary="列出当前用户发出的分享",
)
async def list_my_shares(
    request: Request,
    db: DB = None,
    user: CurrentUser = None,
):
    result = await db.execute(
        select(SharingRecord).where(SharingRecord.shared_by_id == user.id).order_by(SharingRecord.created_at.desc())
    )
    records = result.scalars().all()
    return [_build_response(r, request) for r in records]


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT, summary="撤销分享")
async def revoke(share_id: int, db: DB = None, user: CurrentUser = None):
    result = await db.execute(select(SharingRecord).where(SharingRecord.id == share_id, SharingRecord.shared_by_id == user.id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分享记录不存在或无权操作")
    await db.delete(record)
    await db.commit()


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
            status_code=status.HTTP_410_GONE if e.code == "TOKEN_EXPIRED" else status.HTTP_404_NOT_FOUND,
            detail={"code": e.code, "message": e.message},
        )
    await db.refresh(record, ["knowledge_item"])
    return PublicAccessResponse(
        knowledge_item_id=record.knowledge_item_id,
        name=record.knowledge_item.name,
        permission=record.permission.value,
        expires_at=record.expires_at,
    )
