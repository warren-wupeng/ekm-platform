from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str  # accepts email or username
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class RefreshRequest(BaseModel):
    refresh_token: str


class UserMe(BaseModel):
    id: int
    email: str
    username: str
    display_name: str
    avatar_url: str | None
    department: str | None
    role: str

    model_config = {"from_attributes": True}


class UserMeUpdate(BaseModel):
    display_name: str | None = None
    avatar_url: str | None = None
    department: str | None = None
