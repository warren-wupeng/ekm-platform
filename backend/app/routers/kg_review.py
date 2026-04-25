"""KG quality review HTTP API (Issue #54).

Endpoints:

  GET   /api/v1/kg/review-queue                list edges needing review
  POST  /api/v1/kg/review-queue/{edge_id}/approve    approve an edge
  POST  /api/v1/kg/review-queue/{edge_id}/reject     reject (soft-delete)
  GET   /api/v1/kg/quality-stats               aggregate quality metrics

All review endpoints require KM_OPS or ADMIN role.
"""

from fastapi import APIRouter, HTTPException, Query, Request, status
from slowapi.util import get_remote_address

from app.core.deps import DB, CurrentUser
from app.core.rate_limit import limiter
from app.models.user import UserRole
from app.services.kg_review import (
    ReviewError,
    approve_edge,
    delete_edge_neo4j,
    list_review_queue,
    quality_stats,
    reject_edge,
    sync_edge_review_neo4j,
)

router = APIRouter(prefix="/api/v1/kg", tags=["kg-review"])

_REVIEW_RATE = "60/minute"

_REVIEWER_ROLES = (UserRole.KM_OPS, UserRole.ADMIN)


def _require_reviewer(user) -> None:
    if user.role not in _REVIEWER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="KM_OPS or ADMIN role required",
        )


# ── Review queue ─────────────────────────────────────────────────────


@router.get("/review-queue")
@limiter.limit(_REVIEW_RATE, key_func=get_remote_address)
async def get_review_queue(
    request: Request,
    db: DB,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    _require_reviewer(user)
    return await list_review_queue(db, page=page, page_size=page_size)


@router.post("/review-queue/{edge_id}/approve")
@limiter.limit(_REVIEW_RATE, key_func=get_remote_address)
async def post_approve(
    request: Request,
    edge_id: int,
    db: DB,
    user: CurrentUser,
):
    _require_reviewer(user)
    try:
        edge = await approve_edge(db, edge_id, reviewer_id=user.id)
        await db.commit()
        # Neo4j sync — best effort, AFTER Postgres commit.
        await sync_edge_review_neo4j(edge.id, needs_review=False)
        return {"status": "approved", "edge_id": edge.id}
    except ReviewError as exc:
        code = status.HTTP_404_NOT_FOUND if exc.code == "not_found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=exc.message)


@router.post("/review-queue/{edge_id}/reject")
@limiter.limit(_REVIEW_RATE, key_func=get_remote_address)
async def post_reject(
    request: Request,
    edge_id: int,
    db: DB,
    user: CurrentUser,
):
    _require_reviewer(user)
    try:
        edge = await reject_edge(db, edge_id, reviewer_id=user.id)
        edge_id_copy = edge.id  # capture before commit detaches
        await db.commit()
        # Neo4j sync — best effort, AFTER Postgres commit.
        await delete_edge_neo4j(edge_id_copy)
        return {"status": "rejected", "edge_id": edge_id_copy}
    except ReviewError as exc:
        code = status.HTTP_404_NOT_FOUND if exc.code == "not_found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=code, detail=exc.message)


# ── Quality stats ────────────────────────────────────────────────────


@router.get("/quality-stats")
@limiter.limit(_REVIEW_RATE, key_func=get_remote_address)
async def get_quality_stats(
    request: Request,
    db: DB,
    user: CurrentUser,
):
    _require_reviewer(user)
    return await quality_stats(db)
