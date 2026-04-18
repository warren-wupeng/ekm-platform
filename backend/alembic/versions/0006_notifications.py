"""notifications table.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-18

Avoids the 0005 duplicate-enum pitfall: we let `sa.Enum` inside
`create_table` own the enum-type lifecycle (no pre-create step).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "type",
            sa.Enum(
                "comment", "like", "mention", "knowledge_update",
                name="notification_type",
            ),
            nullable=False,
        ),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()),
                  nullable=False, server_default="{}"),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index("ix_notifications_id",         "notifications", ["id"])
    op.create_index("ix_notifications_user_id",    "notifications", ["user_id"])
    op.create_index("ix_notifications_type",       "notifications", ["type"])
    op.create_index("ix_notifications_read_at",    "notifications", ["read_at"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])
    # Common query is "unread for this user ordered by newest" — cover it.
    op.create_index(
        "ix_notifications_user_unread",
        "notifications",
        ["user_id", "created_at"],
        postgresql_where=sa.text("read_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_unread", table_name="notifications")
    op.drop_index("ix_notifications_created_at",  table_name="notifications")
    op.drop_index("ix_notifications_read_at",     table_name="notifications")
    op.drop_index("ix_notifications_type",        table_name="notifications")
    op.drop_index("ix_notifications_user_id",     table_name="notifications")
    op.drop_index("ix_notifications_id",          table_name="notifications")
    op.drop_table("notifications")
    sa.Enum(name="notification_type").drop(op.get_bind(), checkfirst=True)
