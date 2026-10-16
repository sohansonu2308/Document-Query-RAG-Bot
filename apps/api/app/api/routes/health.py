"""Health check route."""

from fastapi import APIRouter

from app.core.settings import get_settings
from app.schemas import HealthResponse


router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, summary="Check API health")
def health_check() -> HealthResponse:
    """Return a local process health response without external calls."""
    settings = get_settings()
    return HealthResponse(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
    )
