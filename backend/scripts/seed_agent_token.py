#!/usr/bin/env python3
"""Seed a test AgentToken for staging / local dev.

Usage:
    # From backend/ directory (with .env loaded):
    python -m scripts.seed_agent_token

    # Or via flyctl on staging:
    flyctl ssh console -a ekm-backend -C \
      "cd /app && python -m scripts.seed_agent_token"

Prints the plaintext token exactly once. Copy it — there's no way to
recover it after this script exits.
"""
import asyncio
import sys
from pathlib import Path

# Ensure the backend package is importable when running as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.agent_security import generate_agent_token
from app.core.database import AsyncSessionFactory
from app.models.agent import AgentToken


SEED_NAME = "mira-staging-test"
SEED_SCOPES = ["knowledge:read", "kg:read", "kg:write"]
# created_by_id=1 assumes the first user (admin) exists. Adjust if needed.
SEED_CREATED_BY = 1


async def main() -> None:
    tok = generate_agent_token()

    async with AsyncSessionFactory() as db:
        row = AgentToken(
            name=SEED_NAME,
            token_prefix=tok.prefix,
            token_hash=tok.hashed,
            scopes=SEED_SCOPES,
            created_by_id=SEED_CREATED_BY,
            is_active=True,
        )
        db.add(row)
        await db.commit()

    print("--- Agent token seeded ---")
    print(f"  Name:      {SEED_NAME}")
    print(f"  Prefix:    {tok.prefix}")
    print(f"  Scopes:    {SEED_SCOPES}")
    print(f"  Plaintext: {tok.plaintext}")
    print()
    print("Copy the plaintext above. It cannot be recovered.")


if __name__ == "__main__":
    asyncio.run(main())
