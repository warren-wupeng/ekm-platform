"""Knowledge items API.

Endpoints:
  GET    /api/v1/knowledge/items              paginated list of non-archived items
  GET    /api/v1/knowledge/items/{id}/file    serve raw file bytes (auth required)
  DELETE /api/v1/knowledge/items/{id}         hard-delete an item (owner/km_ops/admin)
"""
from __future__ import annotations

import asyncio
import logging
import mimetypes

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DB
from app.models.knowledge import KnowledgeItem, TagAssignment, Tag
from app.services import storage

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])


@router.get("/items")
async def list_items(
    user: CurrentUser,
    db: DB,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200),
    file_type: str | None = Query(None),
):
    """Paginated list of non-archived knowledge items.

    All authenticated users can call this. Each user sees:
    - Items they uploaded
    - Items shared with them (via sharing_records)
    - ADMIN / KM_OPS see all items
    """
    from app.models.user import UserRole

    base = (
        select(KnowledgeItem)
        .where(KnowledgeItem.is_archived.is_(False))
        .options(
            selectinload(KnowledgeItem.uploader),
            selectinload(KnowledgeItem.tag_assignments).selectinload(TagAssignment.tag),
        )
    )

    # Visibility: admin/km_ops see everything; others see own uploads.
    # Sharing-based visibility is a follow-up; for now, own + admin.
    if user.role not in (UserRole.KM_OPS, UserRole.ADMIN):
        base = base.where(KnowledgeItem.uploader_id == user.id)

    if search:
        base = base.where(KnowledgeItem.name.ilike(f"%{search}%"))

    if file_type:
        base = base.where(KnowledgeItem.file_type == file_type)

    # Count
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Fetch page
    rows = (
        await db.execute(
            base.order_by(KnowledgeItem.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": str(item.id),
                "name": item.name,
                "fileType": item.file_type.value if hasattr(item.file_type, "value") else str(item.file_type),
                "size": item.size,
                "uploadedAt": item.created_at.isoformat(),
                "uploadedBy": item.uploader.display_name if item.uploader else "Unknown",
                "tags": [ta.tag.name for ta in item.tag_assignments if ta.tag],
                "downloads": item.download_count,
            }
            for item in rows
        ],
    }


@router.get("/items/{item_id}/file")
async def serve_file(
    item_id: int,
    user: CurrentUser,
    db: DB,
    inline: bool = Query(False, description="inline=true opens in browser; false triggers download"),
):
    """Serve the raw file bytes for a knowledge item.

    Access rules mirror list_items: admins/km_ops see all, others only own uploads.
    Increments download_count on each successful fetch.
    """
    from app.models.user import UserRole

    item = await db.get(KnowledgeItem, item_id)
    if item is None or item.is_archived:
        raise HTTPException(status_code=404, detail="Not found")

    if user.role not in (UserRole.KM_OPS, UserRole.ADMIN) and item.uploader_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not item.file_path:
        raise HTTPException(status_code=404, detail="File not available")

    try:
        content = await asyncio.to_thread(storage.download, item.file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found in storage")
    except storage.StorageError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    item.download_count += 1
    await db.commit()

    mime, _ = mimetypes.guess_type(item.name)
    disposition = "inline" if inline else "attachment"
    safe_name = item.name.replace('"', '\\"')
    return Response(
        content=content,
        media_type=mime or "application/octet-stream",
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}"',
            "Content-Length": str(len(content)),
        },
    )


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: int,
    user: CurrentUser,
    db: DB,
):
    """Hard-delete a knowledge item.

    The owner, KM_OPS, and ADMIN may delete. Cascade deletes (document
    chunks, parse records, restore requests, tag assignments, sharing
    records) are handled by the database FK constraints.  The underlying
    storage object is removed best-effort; a storage failure does NOT roll
    back the DB deletion.
    """
    from app.models.user import UserRole

    item = await db.get(KnowledgeItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    if user.role not in (UserRole.KM_OPS, UserRole.ADMIN) and item.uploader_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    file_path = item.file_path
    await db.delete(item)
    await db.commit()

    if file_path:
        try:
            await asyncio.to_thread(storage.delete, file_path)
        except Exception:  # noqa: BLE001
            log.warning("Storage delete failed for key=%s (item already removed from DB)", file_path)
