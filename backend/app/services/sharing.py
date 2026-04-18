"""Sharing permission service."""
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeItem
from app.models.sharing import SharingRecord, SharePermission
from app.models.user import User
from app.schemas.sharing import CreateShareRequest, ShareTarget


class SharingError(Exception):
    def __init__(self, message: str, code: str = "SHARING_ERROR"):
        self.message = message
        self.code = code


async def create_share(
    db: AsyncSession,
    req: CreateShareRequest,
    shared_by: User,
) -> SharingRecord:
    # Verify knowledge item exists
    result = await db.execute(select(KnowledgeItem).where(KnowledgeItem.id == req.knowledge_item_id))
    item: KnowledgeItem | None = result.scalar_one_or_none()
    if not item:
        raise SharingError("知识条目不存在", "NOT_FOUND")

    # Verify target user if user share
    if req.target == ShareTarget.USER and req.target_user_id:
        r = await db.execute(select(User).where(User.id == req.target_user_id))
        if not r.scalar_one_or_none():
            raise SharingError("目标用户不存在", "USER_NOT_FOUND")

    token: str | None = None
    expires_at: datetime | None = None

    if req.target == ShareTarget.PUBLIC:
        token = secrets.token_urlsafe(24)
        if req.expires_hours is not None:
            expires_at = datetime.now(timezone.utc) + timedelta(hours=req.expires_hours)

    record = SharingRecord(
        knowledge_item_id=req.knowledge_item_id,
        shared_by_id=shared_by.id,
        shared_to_user_id=req.target_user_id if req.target == ShareTarget.USER else None,
        shared_to_department=req.target_department if req.target == ShareTarget.DEPARTMENT else None,
        permission=SharePermission(req.permission.value),
        token=token,
        expires_at=expires_at,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record


async def resolve_public_token(db: AsyncSession, token: str) -> SharingRecord:
    result = await db.execute(select(SharingRecord).where(SharingRecord.token == token))
    record: SharingRecord | None = result.scalar_one_or_none()
    if not record:
        raise SharingError("分享链接无效", "INVALID_TOKEN")
    if record.expires_at and record.expires_at < datetime.now(timezone.utc):
        raise SharingError("分享链接已过期", "TOKEN_EXPIRED")
    return record


async def check_user_access(
    db: AsyncSession,
    knowledge_item_id: int,
    user: User,
    required: SharePermission = SharePermission.VIEW,
) -> bool:
    """Return True if user has at least `required` permission on the item."""
    PERM_RANK = {SharePermission.VIEW: 1, SharePermission.DOWNLOAD: 2, SharePermission.EDIT: 3}

    result = await db.execute(
        select(SharingRecord).where(
            SharingRecord.knowledge_item_id == knowledge_item_id,
            (
                (SharingRecord.shared_to_user_id == user.id)
                | (SharingRecord.shared_to_department == user.department)
                | (SharingRecord.token.is_not(None))   # public shares count
            ),
        )
    )
    records = result.scalars().all()

    for rec in records:
        if PERM_RANK.get(rec.permission, 0) >= PERM_RANK[required]:
            # Check expiry on public shares
            if rec.token and rec.expires_at and rec.expires_at < datetime.now(timezone.utc):
                continue
            return True

    # Owner always has access
    item_res = await db.execute(select(KnowledgeItem).where(KnowledgeItem.id == knowledge_item_id))
    item = item_res.scalar_one_or_none()
    return bool(item and item.uploader_id == user.id)
