"""Knowledge items API.

Endpoints:
  GET /api/v1/knowledge/items   paginated list of non-archived items
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DB
from app.models.knowledge import KnowledgeItem, TagAssignment, Tag

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
