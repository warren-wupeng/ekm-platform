"""Archive restore requests (US-060/062).

Flow:
  1. User submits an ArchiveRestoreRequest for a knowledge item they
     want back from the archive (typically one they authored, but the
     router decides authorization — model stays dumb).
  2. KM Ops (UserRole.KM_OPS or ADMIN) reviews and approves/rejects,
     optionally with a review_note. The status transition happens on
     the same row — we never mutate a reviewed request again, so each
     row is effectively immutable after review. That gives us a free
     audit log without a side table.
  3. On approval: un-archive the item (is_archived=False, archived_at=
     NULL, archive_reminder_sent_at=NULL so the window restarts fresh),
     notify submitter. On rejection: just notify.

Two FKs point at `users` (submitter + reviewer), so relationships
declare `foreign_keys=` explicitly — SQLAlchemy can't guess otherwise.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    DateTime, Enum, ForeignKey, Integer, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RestoreStatus(str, enum.Enum):
    PENDING  = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ArchiveRestoreRequest(Base):
    __tablename__ = "archive_restore_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # The archived knowledge item the user wants back. CASCADE because
    # if the item is permanently destroyed the request history for it
    # is meaningless.
    knowledge_item_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("knowledge_items.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    # Submitter — who wants it back. RESTRICT: keep the audit trail
    # accurate even if a user is later deleted (admin must re-home
    # their requests explicitly).
    submitted_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False, index=True,
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RestoreStatus] = mapped_column(
        # Same values_callable pattern we use on UserRole /
        # NotificationType — SQLAlchemy otherwise persists the enum
        # *name* ("PENDING") instead of its .value ("pending").
        Enum(
            RestoreStatus,
            values_callable=lambda obj: [e.value for e in obj],
            name="restore_status",
        ),
        nullable=False, default=RestoreStatus.PENDING, index=True,
    )

    # Reviewer details. NULL until review happens.
    reviewed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True, index=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Explicit foreign_keys — required when 2+ FKs point at the same
    # table (user), else SQLAlchemy can't decide which side joins.
    submitted_by: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[submitted_by_id],
    )
    reviewed_by: Mapped["User | None"] = relationship(  # noqa: F821
        "User", foreign_keys=[reviewed_by_id],
    )
    knowledge_item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem")  # noqa: F821

    def __repr__(self) -> str:
        return (
            f"<ArchiveRestoreRequest id={self.id} item={self.knowledge_item_id} "
            f"status={self.status.value}>"
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "knowledge_item_id": self.knowledge_item_id,
            "submitted_by_id": self.submitted_by_id,
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "reason": self.reason,
            "status": self.status.value,
            "reviewed_by_id": self.reviewed_by_id,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
            "review_note": self.review_note,
        }
