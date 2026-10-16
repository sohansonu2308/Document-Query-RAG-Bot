"""Lazy local embedding providers.

Importing this module never imports fastembed or downloads a model.  The
provider is deliberately small so another local CPU model can be substituted
without changing ingestion or retrieval.
"""

from __future__ import annotations

import math
import threading
from typing import Protocol, Sequence


class EmbeddingProvider(Protocol):
    """Minimal seam used by document ingestion and question retrieval."""

    @property
    def model_name(self) -> str:
        ...

    @property
    def dimension(self) -> int:
        ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        ...


def validate_embedding(vector: Sequence[float], dimension: int) -> list[float] | None:
    """Return a finite, non-zero vector with the configured dimension."""
    try:
        values = [float(value) for value in vector]
    except (TypeError, ValueError):
        return None
    if len(values) != dimension or not all(math.isfinite(value) for value in values):
        return None
    if math.hypot(*values) == 0:
        return None
    return values


class FastEmbedProvider:
    """FastEmbed-backed CPU provider with lazy model initialization."""

    def __init__(
        self,
        model_name: str = "BAAI/bge-small-en-v1.5",
        *,
        dimension: int = 384,
        cache_dir: str | None = None,
        batch_size: int = 32,
    ) -> None:
        self._model_name = model_name
        self._dimension = dimension
        self._cache_dir = cache_dir
        self._batch_size = batch_size
        self._model = None
        self._model_lock = threading.Lock()

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        return self._dimension

    def _get_model(self):
        """Load fastembed only on the first real embedding request."""
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    from fastembed import TextEmbedding

                    # FastEmbed's default execution path is CPU-compatible;
                    # avoid version-specific provider kwargs so the supported
                    # 0.3+ range remains usable.
                    kwargs = {"model_name": self._model_name}
                    if self._cache_dir:
                        kwargs["cache_dir"] = self._cache_dir
                    self._model = TextEmbedding(**kwargs)
        return self._model

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = self._get_model().embed(list(texts), batch_size=self._batch_size)
        return [list(map(float, vector)) for vector in vectors]
