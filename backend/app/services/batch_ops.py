"""Batch operations on knowledge items — move / delete / share (US-055).

One function per op, all sharing the same contract:

    async def batch_X(db, *, user, ids, op_payload) -> BatchResult

`BatchResult` is a plain dict with `{succeeded: [...], failed: [...]}`.
Each failed item carries a short `reason` code the frontend can map to
copy. The router translates this into a 207 Multi-Status body.

Design choices:

1. Per-item isolation. A permission miss or "not found" on item 3 must
   not abort items 4..N. We wrap each item's DB mutation in a SAVEPOINT
   (`async with db.begin_nested()`) so a flush failure — e.g. an FK
   violation, a deadlock, a stale reference — rolls back only that
   item's changes and leaves the outer transaction healthy for the
   next iteration. Without the savepoint, any flush error would
   poison the async session and silently fail every subsequent item
   as R_UNEXPECTED.

2. Single outer transaction. We flush per-item inside savepoints but
   commit once at the router level. If any unexpected exception
   escapes the loop, the router's exception handler rolls back the
   whole batch — better than a half-applied move.

3. RBAC reuse. We lean on `services/sharing.check_user_access` for
   move/share, and a small `_can_manage` helper for delete/share (which
   require ownership, not just EDIT access). No new permission model.

4. Audit log. One `AuditLog` row per item per batch, grouped by a
   `batch_id` (UUID hex) we emit in `detail`. That lets ops query
   "show me all outcomes for batch X" without a separate table —
   consistent with #58's "the row is the audit log" principle.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge import Category, KnowledgeItem
from app.models.sharing import AuditAction, AuditLog, SharePermission
from app.models.user import User, UserRole
from app.schemas.sharing import CreateShareRequest, PermissionLevel, ShareTarget
from app.services.sharing import check_user_access, create_share

log = logging.getLogger(__name__)


# ── Result shape ──────────────────────────────────────────────────────

SuccessItem = dict[str, Any]  # {id: int, ...optional op-specific fields}
FailureItem = dict[str, Any]  # {id: int, reason: str}
BatchResult = dict[str, Any]  # {succeeded: [...], failed: [...], batch_id: str}


# ── Reason codes ──────────────────────────────────────────────────────
# Short stable strings. Frontend maps to copy; tests assert on these.

R_NOT_FOUND = "NOT_FOUND"
R_PERMISSION_DENIED = "PERMISSION_DENIED"
R_INVALID_TARGET = "INVALID_TARGET"  # move: category_id doesn't exist
R_ALREADY_DELETED = "ALREADY_DELETED"  # paranoia; cascaded deletes shouldn't surface this
R_UNEXPECTED = "UNEXPECTED"


# ── Helpers ───────────────────────────────────────────────────────────


def _can_manage(item: KnowledgeItem, user: User) -> bool:
    """Owner-or-admin gate. Used by delete and share (EDIT-shared users
    should not be able to delete someone else's doc or re-share it)."""
    return user.role == UserRole.ADMIN or item.uploader_id == user.id


def _new_batch_id() -> str:
    # 32-hex chars; compact enough to index + grep, random enough to
    # group rows without collisions across concurrent batches.
    return uuid.uuid4().hex


async def _load_items(
    db: AsyncSession,
    ids: Iterable[int],
) -> dict[int, KnowledgeItem]:
    """Fetch the items once up front. Returns id → item; missing ids are
    absent from the dict (caller reports NOT_FOUND for them)."""
    ids = list(ids)
    if not ids:
        return {}
    q = select(KnowledgeItem).where(KnowledgeItem.id.in_(ids))
    rows = (await db.execute(q)).scalars().all()
    return {i.id: i for i in rows}


def _log_result(
    db: AsyncSession,
    *,
    batch_id: str,
    action: AuditAction,
    actor: User,
    item_id: int,
    success: bool,
    reason: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Append one audit row for this item's outcome in the batch."""
    detail: dict[str, Any] = {
        "batch_id": batch_id,
        "result": "succeeded" if success else "failed",
    }
    if reason:
        detail["reason"] = reason
    if extra:
        detail.update(extra)
    db.add(
        AuditLog(
            actor_id=actor.id,
            action=action,
            resource_type="knowledge_item",
            resource_id=item_id,
            detail=detail,
        )
    )


# ── Operations ────────────────────────────────────────────────────────


async def batch_move(
    db: AsyncSession,
    *,
    user: User,
    ids: list[int],
    category_id: int | None,
) -> BatchResult:
    """Move each item to `category_id` (or out of any category if None).

    Permission: EDIT on the item. Owner + admin always qualify (owner
    via check_user_access's fallback, admin via the explicit bypass
    below). Rationale: moving between categories is an edit-level
    action, not an ownership-level one — that matches how other
    shared-editor tools behave.
    """
    batch_id = _new_batch_id()
    succeeded: list[SuccessItem] = []
    failed: list[FailureItem] = []

    # Validate target category once, not N times.
    if category_id is not None:
        cat = (
            await db.execute(select(Category).where(Category.id == category_id))
        ).scalar_one_or_none()
        if cat is None:
            # Degenerate case — every item will fail for the same reason,
            # so short-circuit with INVALID_TARGET on the whole batch
            # rather than writing N audit rows.
            for item_id in ids:
                failed.append({"id": item_id, "reason": R_INVALID_TARGET})
            return {
                "batch_id": batch_id,
                "succeeded": succeeded,
                "failed": failed,
            }

    items = await _load_items(db, ids)

    for item_id in ids:
        item = items.get(item_id)
        if item is None:
            failed.append({"id": item_id, "reason": R_NOT_FOUND})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.UPDATE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_NOT_FOUND,
            )
            continue

        allowed = user.role == UserRole.ADMIN or await check_user_access(
            db,
            item.id,
            user,
            required=SharePermission.EDIT,
        )
        if not allowed:
            failed.append({"id": item_id, "reason": R_PERMISSION_DENIED})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.UPDATE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_PERMISSION_DENIED,
            )
            continue

        old_cat = item.category_id
        try:
            # SAVEPOINT per item — flush failures (FK violations etc.)
            # roll back only this item's change, not the whole batch.
            async with db.begin_nested():
                item.category_id = category_id
                await db.flush()
        except Exception as exc:
            log.exception("batch_move failed on item=%s: %s", item_id, exc)
            failed.append({"id": item_id, "reason": R_UNEXPECTED})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.UPDATE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_UNEXPECTED,
            )
            continue

        succeeded.append({"id": item_id, "category_id": category_id})
        _log_result(
            db,
            batch_id=batch_id,
            action=AuditAction.UPDATE,
            actor=user,
            item_id=item_id,
            success=True,
            extra={"from_category_id": old_cat, "to_category_id": category_id},
        )

    return {"batch_id": batch_id, "succeeded": succeeded, "failed": failed}


async def batch_delete(
    db: AsyncSession,
    *,
    user: User,
    ids: list[int],
) -> BatchResult:
    """Hard-delete each item.

    Permission: owner-or-admin. EDIT-shared users can modify but not
    destroy — delete is the one action where shared access is not
    enough. Matches how Google Drive, Notion, etc. handle this.

    Cascades (tag_assignments, sharing_records) fire automatically via
    the relationship definitions on KnowledgeItem.
    """
    batch_id = _new_batch_id()
    succeeded: list[SuccessItem] = []
    failed: list[FailureItem] = []

    items = await _load_items(db, ids)

    for item_id in ids:
        item = items.get(item_id)
        if item is None:
            failed.append({"id": item_id, "reason": R_NOT_FOUND})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.DELETE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_NOT_FOUND,
            )
            continue

        if not _can_manage(item, user):
            failed.append({"id": item_id, "reason": R_PERMISSION_DENIED})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.DELETE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_PERMISSION_DENIED,
            )
            continue

        # Snapshot metadata outside the savepoint — if the delete rolls
        # back, we still want the snapshot for the audit row on failure
        # paths, and on success we've already captured what we need.
        snapshot = {"name": item.name, "uploader_id": item.uploader_id}
        try:
            async with db.begin_nested():
                await db.delete(item)
                await db.flush()
        except Exception as exc:
            log.exception("batch_delete failed on item=%s: %s", item_id, exc)
            failed.append({"id": item_id, "reason": R_UNEXPECTED})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.DELETE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_UNEXPECTED,
            )
            continue

        succeeded.append({"id": item_id})
        _log_result(
            db,
            batch_id=batch_id,
            action=AuditAction.DELETE,
            actor=user,
            item_id=item_id,
            success=True,
            extra=snapshot,
        )

    return {"batch_id": batch_id, "succeeded": succeeded, "failed": failed}


async def batch_share(
    db: AsyncSession,
    *,
    user: User,
    ids: list[int],
    target: ShareTarget,
    permission: PermissionLevel,
    target_user_id: int | None,
    target_department: str | None,
    expires_hours: int | None,
) -> BatchResult:
    """Share each item with the same target + permission.

    Permission: owner-or-admin. You can't re-share what you don't own —
    transitive sharing would punch holes in the RBAC model we just built.

    Per-item outcome carries the new `share_id` so the frontend can link
    to each created share record in one round trip.
    """
    batch_id = _new_batch_id()
    succeeded: list[SuccessItem] = []
    failed: list[FailureItem] = []

    items = await _load_items(db, ids)

    for item_id in ids:
        item = items.get(item_id)
        if item is None:
            failed.append({"id": item_id, "reason": R_NOT_FOUND})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.SHARE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_NOT_FOUND,
            )
            continue

        if not _can_manage(item, user):
            failed.append({"id": item_id, "reason": R_PERMISSION_DENIED})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.SHARE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_PERMISSION_DENIED,
            )
            continue

        try:
            req = CreateShareRequest(
                knowledge_item_id=item_id,
                target=target,
                permission=permission,
                target_user_id=target_user_id,
                target_department=target_department,
                expires_hours=expires_hours,
            )
            async with db.begin_nested():
                # create_share flushes internally; savepoint catches
                # uniqueness / FK failures without breaking the batch.
                record = await create_share(db, req, shared_by=user)
        except Exception as exc:
            log.exception("batch_share failed on item=%s: %s", item_id, exc)
            failed.append({"id": item_id, "reason": R_UNEXPECTED})
            _log_result(
                db,
                batch_id=batch_id,
                action=AuditAction.SHARE,
                actor=user,
                item_id=item_id,
                success=False,
                reason=R_UNEXPECTED,
            )
            continue

        succeeded.append({"id": item_id, "share_id": record.id})
        _log_result(
            db,
            batch_id=batch_id,
            action=AuditAction.SHARE,
            actor=user,
            item_id=item_id,
            success=True,
            extra={"share_id": record.id, "target": target.value, "permission": permission.value},
        )

    return {"batch_id": batch_id, "succeeded": succeeded, "failed": failed}
