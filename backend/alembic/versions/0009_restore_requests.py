"""archive restore requests + KM_OPS role + restore notification types.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-19

US-060/062: let users ask for archived knowledge back, let KM Ops approve
or reject. Single immutable row per request — reviewed_* columns get set
in-place on decision. That row *is* the audit log.

Adds:
  - 'km_ops' value on existing `userrole` enum
  - 3 values on existing `notification_type` enum
    (restore_request_submitted / _approved / _rejected)
  - new `restore_status` enum (pending / approved / rejected)
  - `archive_restore_requests` table

Renumbered 0008 → 0009 on rebase: #87 (archive rules) shipped first and
took 0008. Chaining linearly from there. Same "loser rebases" pattern
we ran on #86/#87 last cycle.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Extend existing enums — additive, safe.
    #    ALTER TYPE ... ADD VALUE can't run inside a txn block, so commit
    #    the migration's own txn first. IF NOT EXISTS keeps reruns idempotent.
    op.execute("COMMIT")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'km_ops'")
    op.execute(
        "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'restore_request_submitted'"
    )
    op.execute(
        "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'restore_request_approved'"
    )
    op.execute(
        "ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'restore_request_rejected'"
    )

    # 2. New restore_status enum — create_type=True because it's brand new.
    restore_status = sa.Enum(
        "pending", "approved", "rejected",
        name="restore_status",
    )
    restore_status.create(op.get_bind(), checkfirst=True)

    # 3. archive_restore_requests table.
    op.create_table(
        "archive_restore_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "knowledge_item_id", sa.Integer(),
            # CASCADE — if the item is permanently destroyed, requests
            # for it are meaningless. (Soft-delete via is_archived does
            # NOT trigger this; only true row-level delete does.)
            sa.ForeignKey("knowledge_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "submitted_by_id", sa.Integer(),
            # RESTRICT — preserve audit trail even if a user leaves; an
            # admin must re-home or anonymize their requests explicitly.
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "submitted_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "approved", "rejected",
                name="restore_status",
                create_type=False,  # created above
            ),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column(
            "reviewed_by_id", sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_archive_restore_requests_knowledge_item_id",
        "archive_restore_requests", ["knowledge_item_id"],
    )
    op.create_index(
        "ix_archive_restore_requests_submitted_by_id",
        "archive_restore_requests", ["submitted_by_id"],
    )
    op.create_index(
        "ix_archive_restore_requests_reviewed_by_id",
        "archive_restore_requests", ["reviewed_by_id"],
    )
    op.create_index(
        "ix_archive_restore_requests_status",
        "archive_restore_requests", ["status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_archive_restore_requests_status",
        table_name="archive_restore_requests",
    )
    op.drop_index(
        "ix_archive_restore_requests_reviewed_by_id",
        table_name="archive_restore_requests",
    )
    op.drop_index(
        "ix_archive_restore_requests_submitted_by_id",
        table_name="archive_restore_requests",
    )
    op.drop_index(
        "ix_archive_restore_requests_knowledge_item_id",
        table_name="archive_restore_requests",
    )
    op.drop_table("archive_restore_requests")
    sa.Enum(name="restore_status").drop(op.get_bind(), checkfirst=True)
    # Postgres can't DROP VALUE from an enum. The extended values on
    # userrole / notification_type stay — harmless, and avoids the
    # "can't drop an enum value in use" class of problems. Same caveat
    # we documented on 0006 and 0008 (#87).
