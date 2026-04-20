"""agent_tokens table (#49).

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-20

US-113/114: long-lived Bearer credentials for external Agent callers.
See app/models/agent.py for the design rationale behind prefix+hash.

Why a new table instead of reusing users:
  - Agents aren't people. They don't have passwords, emails, sessions.
  - Scopes on an Agent token are declarative (`knowledge:read`, `kg:write`)
    and composable; roles on a User are coarse and mutually exclusive.
  - Different revocation lifecycle — admin rotates the Agent secret, user
    changes password. Keeping them apart avoids auth-code coupling.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        # Unique index on prefix — O(1) lookup without exposing the secret.
        sa.Column("token_prefix", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=255), nullable=False),
        # JSON scopes: ["knowledge:read", "kg:read", "kg:write"].
        sa.Column(
            "scopes", sa.JSON(), nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
        sa.Column(
            "created_by_id", sa.Integer(),
            # RESTRICT — preserve audit trail of who provisioned the key.
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(),
            server_default=sa.true(), nullable=False,
        ),
    )
    op.create_index(
        "ix_agent_tokens_token_prefix",
        "agent_tokens", ["token_prefix"], unique=True,
    )
    op.create_index(
        "ix_agent_tokens_created_by_id",
        "agent_tokens", ["created_by_id"],
    )
    op.create_index(
        "ix_agent_tokens_is_active",
        "agent_tokens", ["is_active"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_tokens_is_active", table_name="agent_tokens")
    op.drop_index("ix_agent_tokens_created_by_id", table_name="agent_tokens")
    op.drop_index("ix_agent_tokens_token_prefix", table_name="agent_tokens")
    op.drop_table("agent_tokens")
