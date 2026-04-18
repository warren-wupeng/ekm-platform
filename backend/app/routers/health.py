from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "ekm-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
