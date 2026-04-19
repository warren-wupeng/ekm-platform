"""Archive-restore-request HTTP API (US-060/062).

Endpoints:

  POST   /api/v1/archive/restore-requests         submit a request
  GET    /api/v1/archive/restore-requests         list
                                                  - regular user: own only
                                                  - km_ops/admin:  all (optional ?mine=1)
                                                  - ?status=pending|approved|rejected
  GET    /api/v1/archive/restore-requests/{id}    read one (own or reviewer)
  POST   /api/v1/archive/restore-requests/{id}/approve  km_ops/admin
  POST   /api/v1/archive/restore-requests/{id}/reject   km_ops/admin

Router commits the transaction once per request. Service layer (see
`services/restore.py`) only add/flushes, so we keep the "one commit per
HTTP call" invariant the rest of the app uses.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DB
from app.models.knowledge import KnowledgeItem
from app.models.restore import ArchiveRestoreRequest, RestoreStatus
from app.models.user import User, UserRole
from app.services.restore import (
    REVIEWER_ROLES,
    RestoreError,
    approve_request,
    reject_request,
    submit_request,
)

router = APIRouter(
    prefix="/api/v1/archive/restore-requests",
    tags=["archive-restore"],
)


# ── Schemas ───────────────────────────────────────────────────────────

class SubmitIn(BaseModel):
    knowledge_item_id: int
    reason: str | None = Field(default=None, max_length=2000)


class ReviewIn(BaseModel):
    """Body for approve and reject.

    Note is optional on approve (nice-to-have) but in practice required
    on reject — we don't enforce it server-side because "the note was
    empty" feels like a lint, not a domain rule. Frontend can nag the
    reviewer to fill it in.
    """
    note: str | None = Field(default=None, max_length=2000)


# ── Helpers ───────────────────────────────────────────────────────────

def _is_reviewer(user: User) -> bool:
    return user.role in REVIEWER_ROLES


def _raise(err: RestoreError) -> None:
    raise HTTPException(
        status_code=err.status_code,
        detail={"code": err.code, "message": err.message},
    )


async def _load_req_with_item(
    db, req_id: int,
) -> tuple[ArchiveRestoreRequest, KnowledgeItem]:
    """Fetch request + its item in two small queries (not a join — the
    item is needed for both permission checks and the approve-side
    un-archive mutation, so load the ORM object, not a row tuple)."""
    req = (await db.execute(
        select(ArchiveRestoreRequest).where(ArchiveRestoreRequest.id == req_id)
    )).scalar_one_or_none()
    if req is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="restore request not found",
        )
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == req.knowledge_item_id)
    )).scalar_one_or_none()
    if item is None:
        # Shouldn't happen — FK is CASCADE. Treat as 404.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="knowledge item missing",
        )
    return req, item


# ── Routes ────────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
async def submit(body: SubmitIn, user: CurrentUser, db: DB) -> dict:
    item = (await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.id == body.knowledge_item_id)
    )).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="knowledge item not found",
        )

    try:
        req = await submit_request(
            db, submitter=user, item=item, reason=body.reason,
        )
    except RestoreError as e:
        _raise(e)

    await db.commit()
    await db.refresh(req)
    return req.to_dict()


@router.get("")
async def list_requests(
    user: CurrentUser,
    db: DB,
    status_filter: RestoreStatus | None = Query(default=None, alias="status"),
    mine: bool = Query(default=False, description="force-filter to own requests even for reviewers"),
) -> list[dict]:
    q = select(ArchiveRestoreRequest).order_by(
        ArchiveRestoreRequest.submitted_at.desc()
    )
    # Non-reviewers can only see their own. `mine=1` is a convenience
    # toggle for reviewers who want their own queue in the UI.
    if not _is_reviewer(user) or mine:
        q = q.where(ArchiveRestoreRequest.submitted_by_id == user.id)
    if status_filter is not None:
        q = q.where(ArchiveRestoreRequest.status == status_filter)

    rows = (await db.execute(q)).scalars().all()
    return [r.to_dict() for r in rows]


@router.get("/{req_id}")
async def read_one(req_id: int, user: CurrentUser, db: DB) -> dict:
    req, _item = await _load_req_with_item(db, req_id)
    if not _is_reviewer(user) and req.submitted_by_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="not your request",
        )
    return req.to_dict()


@router.post("/{req_id}/approve")
async def approve(
    req_id: int, body: ReviewIn, user: CurrentUser, db: DB,
) -> dict:
    if not _is_reviewer(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="km_ops or admin only",
        )
    req, item = await _load_req_with_item(db, req_id)
    try:
        await approve_request(
            db, req=req, item=item, reviewer=user, note=body.note,
        )
    except RestoreError as e:
        _raise(e)
    await db.commit()
    await db.refresh(req)
    return req.to_dict()


@router.post("/{req_id}/reject")
async def reject(
    req_id: int, body: ReviewIn, user: CurrentUser, db: DB,
) -> dict:
    if not _is_reviewer(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="km_ops or admin only",
        )
    req, item = await _load_req_with_item(db, req_id)
    try:
        await reject_request(
            db, req=req, item=item, reviewer=user, note=body.note,
        )
    except RestoreError as e:
        _raise(e)
    await db.commit()
    await db.refresh(req)
    return req.to_dict()
