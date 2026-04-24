"""Agent token management — create, list, revoke.

Endpoints:
  GET    /api/v1/agent-tokens          — list current user's tokens
  POST   /api/v1/agent-tokens          — create new token (returns plaintext ONCE)
  DELETE /api/v1/agent-tokens/{id}     — revoke (is_active=False)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.agent_security import generate_agent_token
from app.core.deps import DB, CurrentUser
from app.models.agent import AgentToken

router = APIRouter(prefix="/api/v1/agent-tokens", tags=["agent-tokens"])

ALLOWED_SCOPES = {"knowledge:read", "kg:read", "kg:write"}


class TokenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    scopes: list[str] = Field(default_factory=lambda: ["knowledge:read"])


def _to_dict(t: AgentToken, plaintext: str | None = None) -> dict:
    d = {
        "id": t.id,
        "name": t.name,
        "token_prefix": t.token_prefix,
        "scopes": t.scopes,
        "is_active": t.is_active,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if plaintext is not None:
        d["token"] = plaintext  # shown once at creation
    return d


@router.get("")
async def list_tokens(db: DB, user: CurrentUser):
    rows = (
        (
            await db.execute(
                select(AgentToken)
                .where(AgentToken.created_by_id == user.id)
                .order_by(AgentToken.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return {"tokens": [_to_dict(t) for t in rows]}


@router.post("", status_code=201)
async def create_token(payload: TokenCreate, db: DB, user: CurrentUser):
    # Validate scopes
    invalid = set(payload.scopes) - ALLOWED_SCOPES
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown scopes: {sorted(invalid)}")
    if not payload.scopes:
        raise HTTPException(status_code=422, detail="At least one scope required")

    new_token = generate_agent_token()
    t = AgentToken(
        name=payload.name,
        token_prefix=new_token.prefix,
        token_hash=new_token.hashed,
        scopes=payload.scopes,
        created_by_id=user.id,
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return _to_dict(t, plaintext=new_token.plaintext)


@router.delete("/{token_id}", status_code=204)
async def revoke_token(token_id: int, db: DB, user: CurrentUser):
    t = (
        await db.execute(
            select(AgentToken).where(AgentToken.id == token_id, AgentToken.created_by_id == user.id)
        )
    ).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="token not found")
    t.is_active = False
    await db.commit()
    return None
