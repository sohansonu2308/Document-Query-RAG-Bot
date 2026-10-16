"""Application settings."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    """Environment-backed settings for the local API and ingestion pipeline."""

    app_name: str = "rag-api"
    app_version: str = "0.1.0"
    cors_origins: list[str] = ["http://localhost:3000"]
    database_url: str = "postgresql://rag:rag@localhost:5432/rag"
    upload_max_bytes: int = Field(default=50 * 1024 * 1024, ge=1)
    chunk_size: int = 1200
    chunk_overlap: int = 200
    retrieval_top_k: int = Field(default=5, ge=1)
    embedding_enabled: bool = True
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dimension: int = Field(default=384, ge=1, le=16000)
    embedding_cache_dir: str | None = None
    embedding_batch_size: int = Field(default=32, ge=1)
    retrieval_keyword_weight: float = Field(default=0.35, ge=0, allow_inf_nan=False)
    retrieval_vector_weight: float = Field(default=0.65, ge=0, allow_inf_nan=False)
    llm_api_key: str | None = None
    llm_base_url: str | None = None
    llm_model: str = "gpt-6-luna"
    llm_timeout_seconds: float = Field(default=20.0, gt=0, le=120)

    @model_validator(mode="after")
    def validate_retrieval_weights(self) -> "Settings":
        if self.retrieval_keyword_weight + self.retrieval_vector_weight <= 0:
            raise ValueError("At least one retrieval weight must be positive.")
        return self

    @property
    def upload_dir(self) -> Path:
        """Return the repository-local directory for original uploads."""
        return REPOSITORY_ROOT / "data" / "uploads"

    model_config = SettingsConfigDict(
        env_prefix="RAG_",
        env_file=REPOSITORY_ROOT / ".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return the cached application settings."""
    return Settings()
