# RAG Research Workspace

Local-first RAG chatbot for uploading mixed documents, asking questions, and
exploring traceable evidence through citations, timelines, contradiction checks,
and knowledge graphs.

## Current scaffold

- `apps/web` — Next.js + TypeScript research workspace UI
- `apps/api` — FastAPI backend with typed health, documents, and chat routes
- `data/uploads` — local source documents (ignored by Git)
- `data/processed` — generated extraction/index artifacts (ignored by Git)
- `docker-compose.yml` — PostgreSQL with pgvector and Redis for local services

The first retrieval slice is now connected: upload UTF-8 text documents, persist
their extracted chunks and local embeddings in PostgreSQL/pgvector, retrieve
matching evidence with hybrid keyword + semantic search, and display cited
answers with retrieval score breakdowns in the workspace UI. GPT generation is
still optional; the current answer path is deterministic and does not require
an API key.

## Requirements

- Node.js 20+
- Python 3.11+
- Docker Desktop (needed for PostgreSQL/pgvector and Redis)

Docker provides the local PostgreSQL/pgvector and Redis services used by the
working upload and retrieval flow.

## Start the frontend

```powershell
cd apps/web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Start the API

```powershell
cd apps/api
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://localhost:8000/docs` for the API documentation.

## Start local services

```powershell
docker compose up -d
```

Copy `.env.example` to `.env` when provider configuration is needed. Keep API
keys out of source files and out of Git.
