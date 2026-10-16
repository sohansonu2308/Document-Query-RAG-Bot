"""Keyword, vector, and hybrid retrieval primitives.

The database repository owns the PostgreSQL/vector work.  Keeping score
merging here makes the ranking deterministic and testable without downloading
an embedding model.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
    "i", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to",
    "was", "what", "when", "where", "which", "who", "why", "with", "you",
}
TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)


@dataclass(frozen=True)
class RetrievalChunk:
    """A chunk candidate with the metadata required for citation."""

    chunk_id: str
    document_id: str
    document_name: str
    chunk_index: int
    text: str


@dataclass(frozen=True)
class RetrievalHit:
    """A ranked chunk with channel scores used to build the citation."""

    chunk: RetrievalChunk
    score: float
    keyword_score: float = 0.0
    vector_score: float = 0.0


def query_terms(query: str) -> list[str]:
    """Tokenize a question while ignoring common connective words."""
    return [token for token in TOKEN_RE.findall(query.lower()) if token not in STOPWORDS]


def keyword_search(
    query: str, chunks: Iterable[RetrievalChunk], top_k: int = 5
) -> list[RetrievalHit]:
    """Return the highest-scoring chunks with stable tie-breaking."""
    terms = query_terms(query)
    if not terms or top_k <= 0:
        return []
    wanted = Counter(terms)
    hits: list[RetrievalHit] = []
    for chunk in chunks:
        counts = Counter(TOKEN_RE.findall(chunk.text.lower()))
        score = sum(counts[term] * frequency for term, frequency in wanted.items())
        if score:
            hits.append(
                RetrievalHit(
                    chunk=chunk,
                    score=float(score),
                    keyword_score=float(score),
                )
            )
    hits.sort(key=lambda hit: (-hit.score, hit.chunk.document_name.lower(), hit.chunk.chunk_index, hit.chunk.chunk_id))
    return hits[:top_k]


def merge_hybrid_results(
    keyword_hits: Iterable[RetrievalHit],
    vector_hits: Iterable[RetrievalHit],
    *,
    top_k: int = 5,
    keyword_weight: float = 0.35,
    vector_weight: float = 0.65,
) -> list[RetrievalHit]:
    """Merge keyword and cosine-similarity results with stable tie-breaking.

    Keyword counts are normalized against the best keyword hit.  Vector scores
    are cosine similarities and are already in the useful ``0..1`` range, so
    they are clamped rather than re-scaled.  A chunk present in either channel
    remains eligible, which lets semantic matches recover results that do not
    share exact tokens with the question.
    """
    if top_k <= 0:
        return []

    keyword_by_id = {hit.chunk.chunk_id: hit for hit in keyword_hits}
    vector_by_id = {hit.chunk.chunk_id: hit for hit in vector_hits}
    all_ids = set(keyword_by_id) | set(vector_by_id)
    if not all_ids:
        return []

    max_keyword = max(
        (max(0.0, hit.keyword_score or hit.score) for hit in keyword_by_id.values()),
        default=0.0,
    )
    merged: list[RetrievalHit] = []
    for chunk_id in all_ids:
        keyword_hit = keyword_by_id.get(chunk_id)
        vector_hit = vector_by_id.get(chunk_id)
        chunk = (vector_hit or keyword_hit).chunk
        keyword_score = (
            (keyword_hit.keyword_score or keyword_hit.score) if keyword_hit else 0.0
        )
        vector_score = (
            (vector_hit.vector_score or vector_hit.score) if vector_hit else 0.0
        )
        normalized_keyword = keyword_score / max_keyword if max_keyword else 0.0
        normalized_vector = max(0.0, min(1.0, vector_score))
        score = keyword_weight * normalized_keyword + vector_weight * normalized_vector
        if score <= 0:
            continue
        merged.append(
            RetrievalHit(
                chunk=chunk,
                score=score,
                keyword_score=keyword_score,
                vector_score=vector_score,
            )
        )

    merged.sort(
        key=lambda hit: (
            -hit.score,
            -hit.vector_score,
            -hit.keyword_score,
            hit.chunk.document_name.lower(),
            hit.chunk.chunk_index,
            hit.chunk.chunk_id,
        )
    )
    return merged[:top_k]
