"""archive rules + knowledge archive tracking.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-18

Adds:
  - archive_rules table (admin-configured retention policies)
  - knowledge_items.archived_at  (when auto-archived — NULL if not)
  - knowledge_items.archive_reminder_sent_at  (de-dup reminder sends)
  - two new values on notification_type: archive_reminder, auto_archived

The filetype enum is reused (already created by 0001); we just reference
it via `create_type=False`. The notification_type enum has two values
added via raw ALTER — Alembic's `op.alter_enum` helper doesn't exist in
the versions we target, so we issue the SQL directly.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Extend notification_type enum — additive, safe.
    #    ALTER TYPE ... ADD VALUE cannot run inside a transaction block,
    #    so we commit first. Alembic's online migrations run in a txn by
    #    default; `IF NOT EXISTS` keeps this idempotent on reruns.
    op.execute("COMMIT")
    op.execute(
        "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'archive_reminder'"
    )
    op.execute(
        "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'auto_archived'"
    )

    # 2. KnowledgeItem archive tracking columns.
    op.add_column(
        "knowledge_items",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_knowledge_items_archived_at",
        "knowledge_items",
        ["archived_at"],
    )
    op.add_column(
        "knowledge_items",
        sa.Column("archive_reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 3. archive_rules table. Reuse existing filetype enum (created by 0001).
    filetype_enum = sa.Enum(
        "document", "image", "archive", "audio", "video", "other",
        name="filetype",
        create_type=False,
    )
    op.create_table(
        "archive_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "category_id", sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("file_type", filetype_enum, nullable=True),
        sa.Column("inactive_days", sa.Integer(), nullable=False),
        sa.Column(
            "enabled", sa.Boolean(),
            nullable=False, server_default=sa.text("true"),
        ),
        sa.Column(
            "created_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET DEFAULT"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index("ix_archive_rules_id",          "archive_rules", ["id"])
    op.create_index("ix_archive_rules_category_id", "archive_rules", ["category_id"])
    op.create_index("ix_archive_rules_file_type",   "archive_rules", ["file_type"])
    op.create_index("ix_archive_rules_enabled",     "archive_rules", ["enabled"])


def downgrade() -> None:
    op.drop_index("ix_archive_rules_enabled",     table_name="archive_rules")
    op.drop_index("ix_archive_rules_file_type",   table_name="archive_rules")
    op.drop_index("ix_archive_rules_category_id", table_name="archive_rules")
    op.drop_index("ix_archive_rules_id",          table_name="archive_rules")
    op.drop_table("archive_rules")

    op.drop_column("knowledge_items", "archive_reminder_sent_at")
    op.drop_index("ix_knowledge_items_archived_at", table_name="knowledge_items")
    op.drop_column("knowledge_items", "archived_at")

    # Postgres doesn't support DROP VALUE from an enum. Leaving the
    # extra enum labels in place is harmless; if you truly need to
    # remove them, recreate the type manually. Same approach the
    # pg_dump docs recommend.
