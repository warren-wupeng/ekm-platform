"""posts + replies + reply_likes

Community discussion threads. 2-layer nesting is enforced at the router
level, not in schema.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── posts ────────────────────────────────────────────────────────────────
    op.create_table(
        "posts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "author_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index("ix_posts_id", "posts", ["id"])
    op.create_index("ix_posts_author_id", "posts", ["author_id"])

    # ── replies ──────────────────────────────────────────────────────────────
    op.create_table(
        "replies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "post_id",
            sa.Integer(),
            sa.ForeignKey("posts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_reply_id",
            sa.Integer(),
            sa.ForeignKey("replies.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_replies_id", "replies", ["id"])
    op.create_index("ix_replies_post_id", "replies", ["post_id"])
    op.create_index("ix_replies_author_id", "replies", ["author_id"])
    op.create_index("ix_replies_parent_reply_id", "replies", ["parent_reply_id"])

    # ── reply_likes ──────────────────────────────────────────────────────────
    op.create_table(
        "reply_likes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "reply_id",
            sa.Integer(),
            sa.ForeignKey("replies.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("reply_id", "user_id", name="uq_reply_likes_reply_user"),
    )
    op.create_index("ix_reply_likes_reply_id", "reply_likes", ["reply_id"])
    op.create_index("ix_reply_likes_user_id", "reply_likes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_reply_likes_user_id", table_name="reply_likes")
    op.drop_index("ix_reply_likes_reply_id", table_name="reply_likes")
    op.drop_table("reply_likes")

    op.drop_index("ix_replies_parent_reply_id", table_name="replies")
    op.drop_index("ix_replies_author_id", table_name="replies")
    op.drop_index("ix_replies_post_id", table_name="replies")
    op.drop_index("ix_replies_id", table_name="replies")
    op.drop_table("replies")

    op.drop_index("ix_posts_author_id", table_name="posts")
    op.drop_index("ix_posts_id", table_name="posts")
    op.drop_table("posts")
