# RAG API

FastAPI backend for uploading UTF-8 text documents, persisting extracted chunks
in PostgreSQL/pgvector, and answering questions with local hybrid retrieval.
FastEmbed runs the default `BAAI/bge-small-en-v1.5` model on the CPU. GPT-6
Luna answer generation is optional and uses an OpenAI-compatible HTTP endpoint;
without complete provider settings, or if the provider is unavailable, answers
fall back to deterministic cited evidence.

## Run locally

From the repository root, copy `.env.example` to `.env`, then from `apps/api`
create and activate a virtual environment, install dependencies, start
PostgreSQL, and run the API:

```powershell
# From the repository root:
Copy-Item .env.example .env

# From apps/api:
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# From the repository root, in another terminal:
docker compose up -d postgres

# Back in apps/api (the API also reads the repository-root .env automatically):
uvicorn app.main:app --reload
```

Environment variables still override the root `.env` values. Loading the root
file is independent of the process working directory, so `uvicorn app.main:app`
and the reindex command use the same configuration.

The first upload or chat request that can use vector search downloads the
configured embedding model (about 130 MB for the default model) into
FastEmbed's cache. Set `RAG_EMBEDDING_CACHE_DIR` to choose a persistent cache
location. Model loading is lazy, so starting the API does not download it.

Embedding and retrieval settings can be adjusted with environment variables:
`RAG_EMBEDDING_ENABLED`, `RAG_EMBEDDING_MODEL`, `RAG_EMBEDDING_DIMENSION`,
`RAG_EMBEDDING_BATCH_SIZE`, `RAG_RETRIEVAL_KEYWORD_WEIGHT`, and
`RAG_RETRIEVAL_VECTOR_WEIGHT`. If pgvector, FastEmbed, or a model download is
unavailable, ingestion and chat continue with deterministic keyword retrieval.
Each stored vector also records its embedding model. Chat only uses vectors
tagged with the currently configured model; untagged or model-mismatched vectors
are intentionally treated as stale.

Optional answer generation is configured in the root `.env` with
`RAG_LLM_API_KEY`, `RAG_LLM_BASE_URL`, `RAG_LLM_MODEL` (default
`gpt-6-luna`), and `RAG_LLM_TIMEOUT_SECONDS` (default `20`). The base URL may
either end at an OpenAI-compatible `/v1` path or include `/chat/completions`.
The API sends numbered retrieved evidence and requires citation markers in the
provider response; missing/invalid citations, malformed responses, non-2xx
responses, timeouts, and network errors use the deterministic fallback. Secrets
are used only in the request authorization header and are never returned.

The API is available at `http://localhost:8000`; interactive documentation is
at `http://localhost:8000/docs`. The default database URL matches the supplied
PostgreSQL compose service. The `.env` value
`postgresql+psycopg://rag:rag@localhost:5432/rag` is also accepted.

Uploads are stored with generated filenames under the repository's
`data/uploads` directory. UTF-8 `.txt`, `.md`, and `.csv` files, plus `.pdf`,
`.docx`, `.xlsx`, and `.pptx` files, up to 50 MiB per file by default, are
accepted. Override the limit with `RAG_UPLOAD_MAX_BYTES` in the repository-root
`.env`. CSV rows are
normalized into searchable pipe-separated text. Extracted chunks retain source
locations in their text: PDF page, DOCX section/paragraph or table row, XLSX
sheet/row, and PPTX slide. XLSX extraction reads cached cell values only (it
does not execute formulas or macros), and is capped at 50 sheets, 5,000 rows,
100 columns per sheet, 500,000 cells, and 2,000,000 extracted characters.

The additional formats use PyMuPDF (`fitz`), python-docx, openpyxl, and
python-pptx, installed by `requirements.txt`. Malformed or empty documents
return a 400 response; malformed UTF-8 text files return a UTF-8-specific 400.

## Endpoints

- `GET /health` — local health response
- `POST /documents` — multipart upload using the `file` field; validates, stores,
  extracts, chunks, and persists a document
- `GET /documents` — persisted document metadata, chunk counts, and statuses
- `DELETE /documents/{document_id}` — deletes the document row (cascading its
  chunks) and the corresponding stored upload; returns the deleted `id` and `name`
- `POST /chat` — JSON body `{"question":"..."}` (or the legacy `message` field);
  returns an answer assembled from matching chunks and citations, with
   `answer_mode` (`llm` or `deterministic`), optional `answer_provider` and
   `answer_model`, `strategy`, `embedding_model`, and keyword/vector scores on
  each source

Document deletion uses a filesystem quarantine step for consistency. The stored
upload is atomically renamed within `data/uploads`, then the document row is
deleted in a PostgreSQL transaction; failed database deletion restores the
renamed file. Only after the transaction commits is the quarantined file
permanently unlinked, so a file-operation failure cannot leave a database row
pointing at a missing upload. A final cleanup failure returns `503` and leaves
an unreferenced `.delete-*` artifact for cleanup.

## Reindex existing chunks

After changing `RAG_EMBEDDING_MODEL`, or when older chunks have no vector/model
tag, run the explicit backend reindex command from `apps/api`:

```powershell
python -m app.reindex
python -m app.reindex --batch-size 16
```

It only updates `document_chunks.embedding` and `document_chunks.embedding_model`
for missing or model-mismatched vectors. Chunk text, document metadata, and
uploaded files are not changed. The command reports scanned, successful, and
failed embeddings; a failed embedding does not prevent other batches from
being attempted.

Example smoke flow:

```powershell
curl.exe -F "file=@notes.md" http://localhost:8000/documents
curl.exe http://localhost:8000/documents
curl.exe -H "Content-Type: application/json" `
  -d '{"question":"What does the document say about launch?"}' `
  http://localhost:8000/chat
```

## Checks

Run the focused pure-service tests and compile check from `apps/api`:

```powershell
python -m pip install pytest
python -m pytest -q
python -m compileall -q app tests
```

The pure extraction and retrieval tests do not need PostgreSQL or a model
download. Upload and chat requests require PostgreSQL to be reachable at
`RAG_DATABASE_URL`; tables, the `vector` extension, and HNSW (or ivfflat)
indexes are created automatically on the first document or chat operation.
