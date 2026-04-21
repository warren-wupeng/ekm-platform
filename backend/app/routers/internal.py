"""Internal service-to-service API.

These endpoints are called by ekm-collab (Hocuspocus) and authenticated
via a shared INTERNAL_SERVICE_KEY header — NOT user JWT.  They must never
be exposed to end users; keep them behind an internal network or verify
the header in every handler.
"""

from fastapi import APIRouter, Header, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.knowledge import KnowledgeItem
from app.models.sharing import SharingRecord, SharePermission

router = APIRouter(prefix="/api/v1/internal", tags=["internal"])


def _verify_service_key(x_service_key: str = Header(...)) -> None:
    """Reject requests without a valid service key."""
    if not settings.INTERNAL_SERVICE_KEY:
        raise HTTPException(status_code=503, detail="Internal API not configured")
    if x_service_key != settings.INTERNAL_SERVICE_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


# ---------- 1. Content persistence (Hocuspocus onStoreDocument) ----------

class ContentUpdate(BaseModel):
    content: str  # HTML from Tiptap


@router.put("/items/{item_id}/content")
async def update_item_content(
    item_id: int,
    body: ContentUpdate,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_verify_service_key),
):
    """Persist collaborative-editing content to the knowledge item.

    Called by Hocuspocus server on document store.  Overwrites the
    `content` column with the latest Tiptap HTML.
    """
    item = await db.get(KnowledgeItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    item.content = body.content
    # get_db auto-commits on success
    return {"ok": True}


# ---------- 2. Room access check (Hocuspocus onAuthenticate) ----------

@router.get("/items/{item_id}/access")
async def check_item_access(
    item_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_verify_service_key),
):
    """Check whether *user_id* may access *item_id* for collaborative editing.

    Returns 200 with ``{"allowed": true, "permission": "..."}`` if the user
    is the owner, an admin/KM_OPS, or has a sharing record with EDIT
    permission.  Returns 200 with ``{"allowed": false}`` otherwise (Raven's
    onAuthenticate maps this to a WebSocket reject).
    """
    item = await db.get(KnowledgeItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Owner always allowed
    if item.uploader_id == user_id:
        return {"allowed": True, "permission": "owner"}

    # Admin / KM_OPS bypass (import here to avoid circular dep at module level)
    from app.models.user import User, UserRole
    user = await db.get(User, user_id)
    if user and user.role in (UserRole.ADMIN, UserRole.KM_OPS):
        return {"allowed": True, "permission": user.role.value}

    # Check sharing records
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
    share = result.scalar_one_or_none()
    if share:
        return {"allowed": True, "permission": "shared_edit"}

    return {"allowed": False}
