"""Archive rules — admin-configured retention policies.

A rule says "items matching (category, file_type) that haven't been updated
in N days should be archived". The daily worker sweeps:

  1. For each enabled rule, find items where:
        is_archived = FALSE
        updated_at <= now - inactive_days
        (category matches if rule.category_id is set)
        (file_type matches if rule.file_type is set)

  2. For items entering the final 7-day window before archive, send a
     reminder (email + in-app notification) — but only once per cycle,
     tracked via KnowledgeItem.archive_reminder_sent_at.

  3. For items past the threshold, flip is_archived=True, set archived_at,
     and fire an AUTO_ARCHIVED notification.

Keep rules narrow & additive. An item matches a rule if *every* set field
on the rule matches. NULL on the rule = wildcard for that field. Two rules
can match the same item; whichever threshold fires first wins (min
inactive_days — see services/archive.py for the resolver).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey, Integer, String, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.knowledge import FileType


class ArchiveRule(Base):
    __tablename__ = "archive_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # Scope filters — all NULLs = "matches any item".
    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    file_type: Mapped[FileType | None] = mapped_column(
        # Reuse the existing Postgres enum (already created by 0001).
        # `create_type=False` tells SQLAlchemy not to try to create it again.
        Enum(
            FileType,
            values_callable=lambda obj: [e.value for e in obj],
            name="filetype",
            create_type=False,
        ),
        nullable=True, index=True,
    )

    # Threshold — items untouched for this many days auto-archive.
    inactive_days: Mapped[int] = mapped_column(Integer, nullable=False)

    # Soft toggle — lets admins pause a rule without losing its config.
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    # Audit / ownership — so you know who to blame.
    #
    # ondelete=RESTRICT: refuse to delete a user who still authors rules.
    # Rules are admin config, not content — if someone's leaving the team,
    # an admin should reassign/delete their rules first. This also
    # sidesteps the "SET DEFAULT on NOT NULL without server_default" bug
    # Sage flagged as P1 on PR #87 review.
    created_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    category: Mapped["Category | None"] = relationship("Category")  # noqa: F821
    created_by: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return (
            f"<ArchiveRule id={self.id} days={self.inactive_days} "
            f"cat={self.category_id} type={self.file_type} enabled={self.enabled}>"
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "category_id": self.category_id,
            "file_type": self.file_type.value if self.file_type else None,
            "inactive_days": self.inactive_days,
            "enabled": self.enabled,
            "created_by_id": self.created_by_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
