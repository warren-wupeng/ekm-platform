"""Archive-restore-request service layer.

Glue between the router and the database + notification dispatch. The
router owns the transaction boundary; helpers here only `db.add`/`flush`
and leave the commit to the caller (same contract as `services/notify.py`).

Three operations:

  * submit_request — user asks for their archived doc back
  * approve_request — KM Ops un-archives + notifies submitter
  * reject_request — KM Ops notes a reason + notifies submitter

All three fan out in-app notifications via `services/notify.dispatch`,
which writes to the notifications table (durable) and pushes over WS if
the recipient is online. Email nudges are intentionally *not* wired here
yet — they land when #87's mailer is on main, at which point the worker
already has a mailer reference and we can revisit.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import KnowledgeItem
from app.models.notification import NotificationType
from app.models.restore import ArchiveRestoreRequest, RestoreStatus
from app.models.user import User, UserRole
from app.services.notify import dispatch


# Roles allowed to review (approve/reject) a restore request.
REVIEWER_ROLES: tuple[UserRole, ...] = (UserRole.ADMIN, UserRole.KM_OPS)


class RestoreError(Exception):
    """Domain error for restore-request flows.

    Router maps to HTTP status via `.status_code`. Using a custom type
    instead of raising HTTPException in the service keeps this module
    framework-agnostic (unit tests don't need FastAPI).
    """

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


async def _load_reviewers(db: AsyncSession) -> list[User]:
    """All active users with a reviewer role — the submit fan-out target."""
    q = select(User).where(
        User.is_active.is_(True),
        User.role.in_(REVIEWER_ROLES),
    )
    return list((await db.execute(q)).scalars().all())


async def submit_request(
    db: AsyncSession,
    *,
    submitter: User,
    item: KnowledgeItem,
    reason: str | None,
) -> ArchiveRestoreRequest:
    """Create a PENDING request and notify all KM-Ops/Admin reviewers.

    Preconditions enforced here (not in the router) so CLI / background
    callers get the same safety:
      - item must be archived
      - at most one PENDING request per item (FIFO; next user must wait)
    """
    if not item.is_archived:
        raise RestoreError(
            "NOT_ARCHIVED",
            "item is not archived; nothing to restore",
            status_code=409,
        )

    # FIFO: block duplicate PENDING requests on the same item. This is a
    # read-check-then-write — fine here because the request cadence is
    # human-scale (no hot contention), and a duplicate is a harmless 409.
    existing = await db.execute(
        select(ArchiveRestoreRequest.id).where(
            ArchiveRestoreRequest.knowledge_item_id == item.id,
            ArchiveRestoreRequest.status == RestoreStatus.PENDING,
        ).limit(1)
    )
    if existing.scalar_one_or_none() is not None:
        raise RestoreError(
            "ALREADY_PENDING",
            "a pending restore request already exists for this item",
            status_code=409,
        )

    req = ArchiveRestoreRequest(
        knowledge_item_id=item.id,
        submitted_by_id=submitter.id,
        reason=reason,
        status=RestoreStatus.PENDING,
    )
    db.add(req)
    await db.flush()  # populate req.id + req.submitted_at

    # Fan out to all reviewers in-app. If zero reviewers exist the request
    # just sits PENDING — an admin can still see it on list, and it's a
    # config problem, not a data problem.
    reviewers = await _load_reviewers(db)
    payload = {
        "request_id": req.id,
        "knowledge_item_id": item.id,
        "knowledge_item_name": item.name,
        "submitter_id": submitter.id,
        "submitter_name": submitter.display_name,
        "reason": reason,
    }
    title = f"Restore request: {item.name}"
    for r in reviewers:
        await dispatch(
            db,
            user_id=r.id,
            type=NotificationType.RESTORE_REQUEST_SUBMITTED,
            payload=payload,
            title=title,
        )

    return req


async def _finalize_review(
    db: AsyncSession,
    *,
    req: ArchiveRestoreRequest,
    reviewer: User,
    approve: bool,
    note: str | None,
) -> ArchiveRestoreRequest:
    """Shared state transition for approve/reject.

    Enforces: the request must currently be PENDING. Reviewed rows are
    immutable by convention (no endpoint mutates them), so the audit
    trail is the row itself.
    """
    if req.status != RestoreStatus.PENDING:
        raise RestoreError(
            "NOT_PENDING",
            f"request is {req.status.value}; cannot change",
            status_code=409,
        )

    req.status = RestoreStatus.APPROVED if approve else RestoreStatus.REJECTED
    req.reviewed_by_id = reviewer.id
    req.reviewed_at = datetime.now(timezone.utc)
    req.review_note = note

    return req


async def approve_request(
    db: AsyncSession,
    *,
    req: ArchiveRestoreRequest,
    item: KnowledgeItem,
    reviewer: User,
    note: str | None,
) -> ArchiveRestoreRequest:
    """Approve: un-archive the item and notify the submitter."""
    await _finalize_review(
        db, req=req, reviewer=reviewer, approve=True, note=note,
    )

    # Un-archive. Clear archive_reminder_sent_at so the auto-archive
    # window restarts from scratch — otherwise a restored doc that's
    # still past `inactive_days` would be re-archived on the next tick.
    item.is_archived = False
    item.archived_at = None
    item.archive_reminder_sent_at = None

    await dispatch(
        db,
        user_id=req.submitted_by_id,
        type=NotificationType.RESTORE_REQUEST_APPROVED,
        payload={
            "request_id": req.id,
            "knowledge_item_id": item.id,
            "knowledge_item_name": item.name,
            "reviewer_id": reviewer.id,
            "reviewer_name": reviewer.display_name,
            "note": note,
        },
        title=f"Restore approved: {item.name}",
    )
    return req


async def reject_request(
    db: AsyncSession,
    *,
    req: ArchiveRestoreRequest,
    item: KnowledgeItem,
    reviewer: User,
    note: str | None,
) -> ArchiveRestoreRequest:
    """Reject: record the reason and notify the submitter. Item stays archived."""
    await _finalize_review(
        db, req=req, reviewer=reviewer, approve=False, note=note,
    )

    await dispatch(
        db,
        user_id=req.submitted_by_id,
        type=NotificationType.RESTORE_REQUEST_REJECTED,
        payload={
            "request_id": req.id,
            "knowledge_item_id": item.id,
            "knowledge_item_name": item.name,
            "reviewer_id": reviewer.id,
            "reviewer_name": reviewer.display_name,
            "note": note,
        },
        title=f"Restore rejected: {item.name}",
    )
    return req
