"""Chat-quality feedback.

The existing /chat/stream endpoint is stateless — we don't persist the
conversation. So feedback records carry their own snapshot of the exchange
(query + answer + sources) and reference `session_id` / `message_id` as
free-form frontend-generated identifiers (UUIDs typically).

This keeps the data model simple and lets us rebuild "all thumbs-down on
the same session" in SQL without a ChatSession table. If we later add
session persistence, we swap the string fields for FKs.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    DateTime, Enum, ForeignKey, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class FeedbackRating(str, enum.Enum):
    UP   = "up"
    DOWN = "down"


class ChatFeedback(Base):
    __tablename__ = "chat_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Frontend-generated UUID that groups turns in one conversation. Indexed
    # so the admin view can filter "all thumbs on session X".
    session_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Frontend-generated UUID identifying one assistant turn — the thing the
    # 👍/👎 button is attached to. Also indexed for per-message audit.
    message_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    rating: Mapped[FeedbackRating] = mapped_column(
        # values_callable aligns with lowercase enum values created in 0005.
        Enum(
            FeedbackRating,
            values_callable=lambda obj: [e.value for e in obj],
            name="feedback_rating",
        ),
        nullable=False, index=True,
    )
    # Free-form — optional note "wrong source" / "hallucinated X" etc.
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Snapshots — frozen at feedback time so the admin view is reproducible
    # even if the underlying documents change.
    query_snapshot:   Mapped[str | None] = mapped_column(Text, nullable=True)
    answer_snapshot:  Mapped[str | None] = mapped_column(Text, nullable=True)
    sources_snapshot: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    user: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return f"<ChatFeedback id={self.id} rating={self.rating.value}>"
