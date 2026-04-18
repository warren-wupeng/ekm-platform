from pydantic import BaseModel, EmailStr


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
