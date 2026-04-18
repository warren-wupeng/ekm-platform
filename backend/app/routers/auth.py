from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse, UserMe
from app.services.auth import AuthError, authenticate_user, get_current_user, issue_tokens, refresh_tokens

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)


def _auth_error_to_http(exc: AuthError) -> HTTPException:
    status_map = {
        "INVALID_CREDENTIALS": status.HTTP_401_UNAUTHORIZED,
        "INVALID_ACCESS_TOKEN": status.HTTP_401_UNAUTHORIZED,
        "INVALID_REFRESH_TOKEN": status.HTTP_401_UNAUTHORIZED,
        "WRONG_TOKEN_KIND": status.HTTP_401_UNAUTHORIZED,
        "USER_NOT_FOUND": status.HTTP_401_UNAUTHORIZED,
    }
    return HTTPException(
        status_code=status_map.get(exc.code, status.HTTP_400_BAD_REQUEST),
        detail={"code": exc.code, "message": exc.message},
    )


@router.post("/login", response_model=TokenResponse, summary="用户名/密码登录")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await authenticate_user(db, body.username, body.password)
    except AuthError as e:
        raise _auth_error_to_http(e)
    return issue_tokens(user.id)


@router.post("/refresh", response_model=TokenResponse, summary="刷新 Access Token")
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        tokens = await refresh_tokens(db, body.refresh_token)
    except AuthError as e:
        raise _auth_error_to_http(e)
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="登出（客户端清除 token）")
async def logout():
    # Stateless JWT: client drops the token.
    # For token blocklist support, add Redis revocation here (#future).
    return None


@router.get("/me", response_model=UserMe, summary="获取当前用户信息")
async def me(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")
    try:
        user = await get_current_user(db, credentials.credentials)
    except AuthError as e:
        raise _auth_error_to_http(e)
    return user
