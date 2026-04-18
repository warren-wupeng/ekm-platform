"""Community / knowledge notifications.

One row per notification event, owned by `user_id` (the recipient).
`read_at` NULL = unread; flipped to `now()` when the user acks it.

`payload` is JSONB — each event type writes a different shape, but all
include enough to render the item on the frontend without a join:

  comment : { post_id, reply_id, actor_id, actor_name, snippet }
  like    : { reply_id, actor_id, actor_name }
  mention : { post_id, reply_id, actor_id, actor_name, snippet }
  knowledge_update : { knowledge_id, name, change_summary }

Offline delivery is just "rows with read_at IS NULL created before the
current WS connection time" — no separate queue table needed. When the
socket opens we flush the unread backlog and keep streaming live events.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NotificationType(str, enum.Enum):
    COMMENT           = "comment"            # new reply on your post
    LIKE              = "like"               # someone liked your reply
    MENTION           = "mention"            # @user in a reply
    KNOWLEDGE_UPDATE  = "knowledge_update"   # doc you care about changed
    ARCHIVE_REMINDER  = "archive_reminder"   # your doc will auto-archive soon
    AUTO_ARCHIVED     = "auto_archived"      # your doc was just auto-archived


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    type: Mapped[NotificationType] = mapped_column(
        # `values_callable` makes SQLAlchemy persist the enum *value*
        # ("comment") instead of its name ("COMMENT"), matching the
        # lowercase labels in the Postgres enum. Same fix we applied to
        # UserRole last cycle — see that commit for the long story.
        Enum(
            NotificationType,
            values_callable=lambda obj: [e.value for e in obj],
            name="notification_type",
        ),
        nullable=False, index=True,
    )
    # Free-form per-type payload; see module docstring for the shape.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # Optional short human-readable title — makes the list endpoint cheap
    # (no need to format from payload server-side).
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)

    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        nullable=False, index=True,
    )

    user: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Notification id={self.id} type={self.type.value} user={self.user_id}>"

    def to_dict(self) -> dict:
        """Canonical wire-format for a Notification.

        Used by both the REST serializer and the WS push payload so they
        never drift. Keep this file authoritative — if you need a new
        field on the client, add it here.
        """
        return {
            "id": self.id,
            "type": self.type.value,
            "title": self.title,
            "payload": self.payload,
            "read": self.read_at is not None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
