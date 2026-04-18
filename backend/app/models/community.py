"""Community models — Post, Reply, ReplyLike.

Discussion threads attached to the knowledge platform. We cap reply
nesting at 2 levels (top-level + one child) so the UI stays readable —
Reddit-style infinite nesting is out of scope.

Nesting rule is enforced in the router, not the schema: the DB will
happily let you point parent_reply_id at a reply whose own parent isn't
NULL, but the API rejects it. Schema-level constraints (e.g. a CHECK)
would add migrations cost for little gain.
"""
from datetime import datetime

from sqlalchemy import (
    DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Denormalised counter; maintained by the router on reply insert/delete
    # so listing the timeline doesn't require a JOIN+COUNT per row.
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    author: Mapped["User"] = relationship("User")  # noqa: F821
    replies: Mapped[list["Reply"]] = relationship(
        "Reply", back_populates="post", cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Post id={self.id} title={self.title[:30]!r}>"


class Reply(Base):
    __tablename__ = "replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    parent_reply_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("replies.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    like_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Soft-delete column so we keep conversation structure when a parent
    # reply is removed but its children are still meaningful. Only the
    # content is blanked; children stay visible with a "[deleted]" marker.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    post: Mapped["Post"] = relationship("Post", back_populates="replies")
    author: Mapped["User"] = relationship("User")  # noqa: F821
    parent: Mapped["Reply | None"] = relationship(
        "Reply", remote_side="Reply.id", back_populates="children",
    )
    children: Mapped[list["Reply"]] = relationship(
        "Reply", back_populates="parent", cascade="all, delete-orphan",
    )
    likes: Mapped[list["ReplyLike"]] = relationship(
        "ReplyLike", back_populates="reply", cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Reply id={self.id} post={self.post_id}>"


class ReplyLike(Base):
    """A single user's like on a reply. Unique (reply_id, user_id) = idempotent."""
    __tablename__ = "reply_likes"
    __table_args__ = (
        UniqueConstraint("reply_id", "user_id", name="uq_reply_likes_reply_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reply_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("replies.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    reply: Mapped["Reply"] = relationship("Reply", back_populates="likes")
