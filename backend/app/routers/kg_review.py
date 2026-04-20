"""KG quality review HTTP API (Issue #54).

Endpoints:

  GET   /api/v1/kg/review-queue                list edges needing review
  POST  /api/v1/kg/review-queue/{edge_id}/approve    approve an edge
  POST  /api/v1/kg/review-queue/{edge_id}/reject     reject (soft-delete)
  GET   /api/v1/kg/quality-stats               aggregate quality metrics

All review endpoints require KM_OPS or ADMIN role.
"""
from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CurrentUser, DB
from app.models.user import UserRole
from app.services.kg_review import (
    ReviewError,
    approve_edge,
    list_review_queue,
    quality_stats,
    reject_edge,
)

router = APIRouter(prefix="/api/v1/kg", tags=["kg-review"])

_REVIEWER_ROLES = (UserRole.KM_OPS, UserRole.ADMIN)


def _require_reviewer(user) -> None:
    if user.role not in _REVIEWER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="KM_OPS or ADMIN role required",
        )


# ── Review queue ─────────────────────────────────────────────────────


@router.get("/review-queue")
async def get_review_queue(
    db: DB,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    _require_reviewer(user)
    return await list_review_queue(db, page=page, page_size=page_size)


@router.post("/review-queue/{edge_id}/approve")
async def post_approve(
    edge_id: int,
    db: DB,
    user: CurrentUser,
):
    _require_reviewer(user)
    try:
        edge = await approve_edge(db, edge_id, reviewer_id=user.id)
        await db.commit()
        return {"status": "approved", "edge_id": edge.id}
    except ReviewError as exc:
        code = status.HTTP_404_NOT_FOUND if exc.code == "not_found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=exc.message)


@router.post("/review-queue/{edge_id}/reject")
async def post_reject(
    edge_id: int,
    db: DB,
    user: CurrentUser,
):
    _require_reviewer(user)
    try:
        edge = await reject_edge(db, edge_id, reviewer_id=user.id)
        await db.commit()
        return {"status": "rejected", "edge_id": edge.id}
    except ReviewError as exc:
        code = status.HTTP_404_NOT_FOUND if exc.code == "not_found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=exc.message)


# ── Quality stats ────────────────────────────────────────────────────


@router.get("/quality-stats")
async def get_quality_stats(
    db: DB,
    user: CurrentUser,
):
    _require_reviewer(user)
    return await quality_stats(db)
