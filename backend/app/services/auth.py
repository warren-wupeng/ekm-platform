from datetime import datetime, timezone

from jose import JWTError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.core.config import settings
from app.models.user import User


class AuthError(Exception):
    def __init__(self, message: str, code: str = "AUTH_ERROR"):
        self.message = message
        self.code = code


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User:
    """Verify credentials; raises AuthError on failure."""
    result = await db.execute(
        select(User).where(
            or_(User.email == username, User.username == username),
            User.is_active == True,  # noqa: E712
        )
    )
    user: User | None = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise AuthError("用户名或密码错误", "INVALID_CREDENTIALS")
    if not verify_password(password, user.hashed_password):
        raise AuthError("用户名或密码错误", "INVALID_CREDENTIALS")

    # Update last_login
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()

    return user


def issue_tokens(user_id: int) -> dict:
    return {
        "access_token": create_access_token(user_id),
        "refresh_token": create_refresh_token(user_id),
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> dict:
    """Validate refresh token and issue a new token pair."""
    try:
        payload = decode_token(refresh_token)
    except JWTError:
        raise AuthError("Refresh token 无效或已过期", "INVALID_REFRESH_TOKEN")

    if payload.get("kind") != "refresh":
        raise AuthError("Token 类型错误", "WRONG_TOKEN_KIND")

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))  # noqa: E712
    user: User | None = result.scalar_one_or_none()
    if not user:
        raise AuthError("用户不存在或已停用", "USER_NOT_FOUND")

    return issue_tokens(user_id)


async def get_current_user(db: AsyncSession, access_token: str) -> User:
    """Dependency-friendly: resolve access token to User."""
    try:
        payload = decode_token(access_token)
    except JWTError:
        raise AuthError("Access token 无效或已过期", "INVALID_ACCESS_TOKEN")

    if payload.get("kind") != "access":
        raise AuthError("Token 类型错误", "WRONG_TOKEN_KIND")

    user_id = int(payload["sub"])
    result = await db.execute(select(User).where(User.id == user_id, User.is_active == True))  # noqa: E712
    user: User | None = result.scalar_one_or_none()
    if not user:
        raise AuthError("用户不存在或已停用", "USER_NOT_FOUND")
    return user
