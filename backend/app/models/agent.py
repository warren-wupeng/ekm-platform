"""AgentToken — long-lived Bearer credential for external Agent callers.

Kept deliberately separate from User + user JWTs:

* Users have passwords, sessions, refresh flows, roles. Agents don't —
  an Agent is just a blob of scopes bound to a hashed secret.
* Users authenticate via short-lived access tokens (minutes). Agent tokens
  are long-lived (months/years) and rotated by re-issuing.
* Compromise response differs: a leaked user token is user-specific; a
  leaked Agent token may have broad scopes across tenants. Separate
  storage + lookup path makes revocation explicit.

Storage model:

* `token_prefix`  — first 12 chars of the plaintext token (indexed).
  Gives an O(1) lookup path without leaking the secret.
* `token_hash`    — bcrypt hash of the FULL plaintext token. The secret
  itself is never stored. Verified against incoming Bearer on every call.
* `scopes`        — JSON array of stable string scopes. Start minimal
  (`knowledge:read`, `kg:read`, `kg:write`); more can be added without
  a schema change.

The prefix-then-hash pattern is the same design GitHub / Stripe use for
API keys: you search by prefix, then constant-time-compare the hash. We
can't look up purely by hash (bcrypt hashes are salted, so the same token
hashes differently every time), and we shouldn't search by raw equality
on the plaintext.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer, JSON, String, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AgentToken(Base):
    __tablename__ = "agent_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Human-readable label: "Tom KG Constructor", "Analytics Bot v2", etc.
    # Not globally unique — two prod/staging keys for the same caller is fine.
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    # First 12 chars of the plaintext token, e.g. "ekmat_4a7f1c".
    # Indexed + unique so lookup is O(1) without seeing the secret.
    token_prefix: Mapped[str] = mapped_column(
        String(32), unique=True, index=True, nullable=False,
    )
    # bcrypt hash of full plaintext. Verified on every request.
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # JSON list of scope strings. Validated against a known set at
    # dependency time (see app/core/agent_deps.py).
    scopes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    # RESTRICT — keep audit trail even if the provisioning admin leaves.
    # An admin must explicitly reassign or revoke their tokens.
    created_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    # Bumped on every successful authenticated call. Used for "is this
    # token actually in use?" dashboards + stale-key pruning.
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Nullable = never expires. Revocation path is `is_active=False`.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_by: Mapped["User"] = relationship("User")  # noqa: F821

    def __repr__(self) -> str:
        return f"<AgentToken id={self.id} name={self.name!r} prefix={self.token_prefix}>"
