"""Model-free tests for optional grounded answer generation."""

import json

from app.services.generation import (
    GroundedAnswerGenerator,
    OpenAICompatibleClient,
    build_grounding_prompt,
)
from app.services.retrieval import RetrievalChunk, RetrievalHit


def _evidence() -> list[RetrievalHit]:
    chunk = RetrievalChunk(
        chunk_id="chunk-1",
        document_id="doc-1",
        document_name="notes.md",
        chunk_index=0,
        text="The launch is scheduled for October.",
    )
    return [RetrievalHit(chunk=chunk, score=1.0)]


class _Response:
    status = 200

    def __init__(self, body: str):
        self.body = body.encode("utf-8")
        self.closed = False

    def read(self) -> bytes:
        return self.body

    def close(self) -> None:
        self.closed = True


def test_grounding_prompt_numbers_evidence_and_forbids_unsupported_claims():
    prompt = build_grounding_prompt("When is launch?", _evidence())

    assert "[1] notes.md (chunk 1)" in prompt
    assert "Every factual statement must include" in prompt
    assert "unsupported claims" in prompt
    assert "The launch is scheduled for October." in prompt


def test_missing_provider_configuration_returns_deterministic_fallback():
    result = GroundedAnswerGenerator().generate("When is launch?", _evidence())

    assert result.answer_mode == "deterministic"
    assert "October" in result.answer
    assert result.answer_provider is None
    assert result.answer_model is None


def test_malformed_provider_response_returns_deterministic_fallback():
    client = OpenAICompatibleClient(
        api_key="test-key",
        base_url="https://example.test/v1",
        model="gpt-6-luna",
        urlopen=lambda request, timeout: _Response("not json"),
    )

    result = GroundedAnswerGenerator(
        model="gpt-6-luna", client=client
    ).generate("When is launch?", _evidence())

    assert result.answer_mode == "deterministic"
    assert "October" in result.answer


def test_configured_client_posts_openai_compatible_payload_and_accepts_citation():
    calls: list[tuple[object, float]] = []

    def fake_urlopen(request, timeout):
        calls.append((request, timeout))
        payload = json.loads(request.data.decode("utf-8"))
        assert payload["model"] == "gpt-6-luna"
        assert payload["messages"][1]["content"].startswith("Answer the question")
        assert "[1]" in payload["messages"][1]["content"]
        assert request.get_header("Authorization") == "Bearer test-key"
        return _Response('{"choices":[{"message":{"content":"Launch is in October [1]."}}]}')

    client = OpenAICompatibleClient(
        api_key="test-key",
        base_url="https://example.test/v1",
        model="gpt-6-luna",
        timeout_seconds=7.5,
        urlopen=fake_urlopen,
    )
    result = GroundedAnswerGenerator(model="gpt-6-luna", client=client).generate(
        "When is launch?", _evidence()
    )

    assert len(calls) == 1
    assert calls[0][1] == 7.5
    assert result.answer == "Launch is in October [1]."
    assert result.answer_mode == "llm"
    assert result.answer_provider == "openai-compatible"
    assert result.answer_model == "gpt-6-luna"


def test_non_success_status_returns_deterministic_fallback():
    client = OpenAICompatibleClient(
        api_key="test-key",
        base_url="https://example.test/v1",
        model="gpt-6-luna",
        urlopen=lambda request, timeout: _ResponseWithStatus(503),
    )

    result = GroundedAnswerGenerator(client=client).generate("When is launch?", _evidence())

    assert result.answer_mode == "deterministic"


class _ResponseWithStatus(_Response):
    def __init__(self, status: int):
        super().__init__("{}")
        self.status = status
