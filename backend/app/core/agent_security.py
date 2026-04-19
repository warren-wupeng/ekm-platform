"""Agent token primitives — generation, hashing, constant-time verify.

Kept in its own module (not bolted onto `core/security.py`) because the
Agent-token lifecycle is distinct from user JWTs:

* Format: ``ekmat_<48 hex chars>`` — the prefix lets ops grep logs for
  leaked tokens and lets HQ block-list the class of credential. 48 hex
  chars = 192 bits of entropy, comfortably above "brute force is cheap".
* Storage: bcrypt-hashed (salted), so two identical tokens hash
  differently — that's why lookup is by `token_prefix` not hash equality.
* Verification: bcrypt's native `checkpw` is the constant-time compare.

No JWT. Agent tokens are opaque random strings; revocation means flipping
``is_active = False`` on the row. JWTs would require a blocklist to get
the same guarantee, and we'd have gained nothing in return.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass

import bcrypt


# Prefix is deliberate:
#   * `ekm`   — project namespace
#   * `at`    — "agent token" (distinguishes from a hypothetical `ekmu_` user key)
#   * `_`     — visual separator
# Users can copy/paste an ekmat_ and instantly tell what it is.
TOKEN_PREFIX_SIGIL = "ekmat_"

# First 12 chars of plaintext stored as `token_prefix` for indexed lookup.
# Includes the sigil + 6 hex chars — enough to be uniqueish for search,
# short enough to keep the DB index tight. Collision risk at 6 hex = 2^24
# is acceptable; the actual uniqueness is enforced by the hash check.
PREFIX_LEN = 12

# 24 random bytes → 48 hex chars body. Combined with the 6-char sigil
# the full token is 54 chars, easy to copy-paste, no ambiguous glyphs.
TOKEN_BODY_BYTES = 24


@dataclass(frozen=True)
class NewAgentToken:
    """Plaintext + derived fields returned by generation. Plaintext is
    only visible at creation time — it's hashed before persistence."""
    plaintext: str       # full token — show this to the caller ONCE
    prefix: str          # PREFIX_LEN-char lookup key stored in DB
    hashed: str          # bcrypt hash stored in DB


def generate_agent_token() -> NewAgentToken:
    """Mint a new plaintext token + its storage form.

    The caller is responsible for persisting `prefix` and `hashed` and
    for displaying `plaintext` to the provisioning admin exactly once.
    After that the plaintext is unrecoverable — if lost, rotate.
    """
    body = secrets.token_hex(TOKEN_BODY_BYTES)
    plaintext = f"{TOKEN_PREFIX_SIGIL}{body}"
    prefix = plaintext[:PREFIX_LEN]
    hashed = bcrypt.hashpw(plaintext.encode(), bcrypt.gensalt()).decode()
    return NewAgentToken(plaintext=plaintext, prefix=prefix, hashed=hashed)


def extract_prefix(plaintext: str) -> str | None:
    """Return the lookup prefix for a candidate token, or None if it's
    obviously malformed. Cheap pre-check before hitting the DB."""
    if not plaintext or not plaintext.startswith(TOKEN_PREFIX_SIGIL):
        return None
    if len(plaintext) < PREFIX_LEN:
        return None
    return plaintext[:PREFIX_LEN]


def verify_agent_token(plaintext: str, hashed: str) -> bool:
    """Constant-time verify. Wraps bcrypt.checkpw so callers don't need
    to know the encoding dance."""
    try:
        return bcrypt.checkpw(plaintext.encode(), hashed.encode())
    except ValueError:
        # Bad hash format in DB — treat as no-match, not as a crash. The
        # only way this fires is a corrupt row, which is a data issue.
        return False
