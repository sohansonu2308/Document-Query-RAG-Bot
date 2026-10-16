"""Document upload, listing, and deletion routes."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.core.settings import get_settings
from app.db import DocumentRepository
from app.schemas import (
    DocumentCreateResponse,
    DocumentDeleteResponse,
    DocumentListResponse,
    DocumentSummary,
)
from app.services.extraction import SUPPORTED_EXTENSIONS, extract_text


router = APIRouter(prefix="/documents", tags=["documents"])


def repository(request: Request) -> DocumentRepository:
    return request.app.state.repository


def _upload_path(upload_dir: Path, stored_filename: str) -> Path:
    """Resolve a stored upload while refusing paths outside the upload root."""
    root = upload_dir.resolve()
    path = (root / stored_filename).resolve()
    if path.parent != root:
        raise ValueError("Stored upload path is outside the upload directory.")
    return path


def _restore_quarantined_file(quarantine_path: Path | None, original_path: Path) -> None:
    """Restore a staged upload after a database operation did not commit."""
    if quarantine_path is not None:
        quarantine_path.replace(original_path)


async def save_upload(upload: UploadFile, destination: Path, max_bytes: int) -> tuple[str, bytes]:
    """Write an upload using a generated basename and enforce its byte limit."""
    destination.mkdir(parents=True, exist_ok=True)
    suffix = Path(upload.filename or "").suffix.lower()
    stored_filename = f"{uuid4().hex}{suffix}"
    path = (destination / stored_filename).resolve()
    if path.parent != destination.resolve():
        raise HTTPException(status_code=400, detail="Invalid upload destination.")

    content = bytearray()
    try:
        with path.open("xb") as output:
            while chunk := await upload.read(64 * 1024):
                content.extend(chunk)
                if len(content) > max_bytes:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {max_bytes} byte limit.")
                output.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return stored_filename, bytes(content)


@router.get("", response_model=DocumentListResponse, summary="List documents")
def list_documents(request: Request) -> DocumentListResponse:
    """Return persisted document metadata and ingestion statuses."""
    try:
        rows = repository(request).list()
    except Exception as error:
        raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error
    documents = [DocumentSummary(**row) for row in rows]
    return DocumentListResponse(documents=documents, total=len(documents), message="Documents loaded.")


@router.post(
    "",
    response_model=DocumentCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and index a document",
)
async def create_document(request: Request, file: Annotated[UploadFile, File(...)]) -> DocumentCreateResponse:
    """Validate, safely store, extract, chunk, and persist a document."""
    original_filename = Path(file.filename or "").name
    suffix = Path(original_filename).suffix.lower()
    if not original_filename or suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail="Only .txt, .md, .csv, .pdf, .docx, .xlsx, and .pptx files are supported.",
        )

    settings = get_settings()
    stored_filename, content = await save_upload(file, settings.upload_dir, settings.upload_max_bytes)
    try:
        extracted_text = await run_in_threadpool(extract_text, original_filename, content)
    except UnicodeDecodeError as error:
        (settings.upload_dir / stored_filename).unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Files must be UTF-8 text.") from error
    except ValueError as error:
        (settings.upload_dir / stored_filename).unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(error)) from error

    try:
        row = await run_in_threadpool(
            repository(request).ingest,
            name=original_filename,
            stored_filename=stored_filename,
            content_type=file.content_type,
            size_bytes=len(content),
            extracted_text=extracted_text,
        )
    except Exception as error:
        raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error
    return DocumentCreateResponse(document=DocumentSummary(**row), message="Document indexed.")


@router.delete(
    "/{document_id}",
    response_model=DocumentDeleteResponse,
    summary="Delete a document",
)
def delete_document(document_id: str, request: Request) -> DocumentDeleteResponse:
    """Delete document metadata, cascading chunks, and its stored upload.

    The upload is first atomically renamed to a same-directory quarantine
    filename. This prevents a database failure from deleting the row while
    leaving an untracked file operation in progress. The row is then deleted
    transactionally; on failure the quarantine file is restored. Once the
    transaction commits, the quarantine file is unlinked. A final unlink
    failure can leave only an unreferenced cleanup artifact, never a row that
    points at a missing upload.
    """
    try:
        document = repository(request).get(document_id)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    settings = get_settings()
    try:
        original_path = _upload_path(settings.upload_dir, document["stored_filename"])
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error

    quarantine_path: Path | None = None
    if original_path.exists():
        quarantine_path = original_path.parent / f".delete-{uuid4().hex}-{original_path.name}"
        try:
            original_path.replace(quarantine_path)
        except OSError as error:
            raise HTTPException(status_code=503, detail="Stored document file could not be staged for deletion.") from error

    try:
        deleted = repository(request).delete(document_id)
    except Exception as error:
        try:
            _restore_quarantined_file(quarantine_path, original_path)
        except OSError as restore_error:
            raise HTTPException(status_code=503, detail="Document storage is unavailable.") from restore_error
        raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error

    if deleted is None:
        try:
            _restore_quarantined_file(quarantine_path, original_path)
        except OSError as error:
            raise HTTPException(status_code=503, detail="Document storage is unavailable.") from error
        raise HTTPException(status_code=404, detail="Document not found.")

    if quarantine_path is not None:
        try:
            quarantine_path.unlink()
        except OSError as error:
            raise HTTPException(
                status_code=503,
                detail="Document metadata was deleted, but the stored file cleanup failed.",
            ) from error

    return DocumentDeleteResponse(id=deleted["id"], name=deleted["name"], message="Document deleted.")
