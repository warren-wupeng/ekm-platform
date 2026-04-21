"""add post_likes table and like_count to posts

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add like_count to posts with default 0
    op.add_column(
        "posts",
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
    )

    # Create post_likes join table
    op.create_table(
        "post_likes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "post_id", sa.Integer(),
            sa.ForeignKey("posts.id", ondelete="CASCADE"),
            nullable=False, index=True,
        ),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False, index=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.UniqueConstraint("post_id", "user_id", name="uq_post_likes_post_user"),
    )


def downgrade() -> None:
    op.drop_table("post_likes")
    op.drop_column("posts", "like_count")
