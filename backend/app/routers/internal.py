"""Internal service-to-service API (ekm-collab → ekm-backend).

Authenticated via X-Service-Key header, NOT user JWT.
"""

from fastapi import APIRouter, Header, HTTPException, Query, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.knowledge import KnowledgeItem
from app.models.sharing import SharingRecord, SharePermission

router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


def _verify_service_key(x_service_key: str = Header(...)) -> None:
    if not settings.INTERNAL_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Internal API not configured")
    if x_service_key != settings.INTERNAL_SERVICE_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


# ── Content persistence (Hocuspocus onStoreDocument) ──────────────────

class InternalContentUpdate(BaseModel):
    html_content: str | None = None  # optional — Yjs server can't render HTML
    yjs_state: str  # base64-encoded Yjs document state


@router.put("/items/{item_id}/content")
async def store_item_content(
    item_id: int,
    body: InternalContentUpdate,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_verify_service_key),
):
    item = await db.get(KnowledgeItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    item.content = body.html_content
    item.yjs_state = body.yjs_state
    # get_db auto-commits on success
    return {"ok": True}


# ── Room access check (Hocuspocus onAuthenticate) ────────────────────

@router.get("/items/{item_id}/access")
async def check_item_access(
    item_id: int,
    user_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_verify_service_key),
):
    item = await db.get(KnowledgeItem, item_id)
    if not item:
        return {"allowed": False}

    # Owner always allowed
    if item.uploader_id == user_id:
        return {"allowed": True, "permission": "owner"}

    # Admin / KM_OPS bypass
    from app.models.user import User, UserRole
    user = await db.get(User, user_id)
    if user and user.role in (UserRole.ADMIN, UserRole.KM_OPS):
        return {"allowed": True, "permission": user.role.value}

    # EDIT sharing record
    stmt = (
        select(SharingRecord)
        .where(
            SharingRecord.knowledge_item_id == item_id,
            SharingRecord.shared_to_user_id == user_id,
            SharingRecord.permission == SharePermission.EDIT,
            SharingRecord.deleted_at.is_(None),
        )
    )
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        return {"allowed": True, "permission": "shared_edit"}

    return {"allowed": False}
