"""chat_feedback — thumbs up/down on assistant turns.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-18
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.String(64), nullable=True),
        sa.Column("message_id", sa.String(64), nullable=True),
        sa.Column(
            "user_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rating",
            sa.Enum("up", "down", name="feedback_rating"),
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("query_snapshot", sa.Text(), nullable=True),
        sa.Column("answer_snapshot", sa.Text(), nullable=True),
        sa.Column("sources_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index("ix_chat_feedback_id",         "chat_feedback", ["id"])
    op.create_index("ix_chat_feedback_session_id", "chat_feedback", ["session_id"])
    op.create_index("ix_chat_feedback_message_id", "chat_feedback", ["message_id"])
    op.create_index("ix_chat_feedback_user_id",    "chat_feedback", ["user_id"])
    op.create_index("ix_chat_feedback_rating",     "chat_feedback", ["rating"])


def downgrade() -> None:
    op.drop_index("ix_chat_feedback_rating",     table_name="chat_feedback")
    op.drop_index("ix_chat_feedback_user_id",    table_name="chat_feedback")
    op.drop_index("ix_chat_feedback_message_id", table_name="chat_feedback")
    op.drop_index("ix_chat_feedback_session_id", table_name="chat_feedback")
    op.drop_index("ix_chat_feedback_id",         table_name="chat_feedback")
    op.drop_table("chat_feedback")
    sa.Enum(name="feedback_rating").drop(op.get_bind(), checkfirst=True)
