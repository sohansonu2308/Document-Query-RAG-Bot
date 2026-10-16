"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import MermaidDiagram from "../MermaidDiagram";

type GuideSection = {
  id: string;
  number: string;
  kicker: string;
  title: string;
  summary: string;
  paragraphs: string[];
  bullets?: string[];
  tags?: string[];
};

type InterviewCard = {
  question: string;
  answer: string;
  cue: string;
};

const PROGRESS_KEY = "lumen-rag-reference-progress-v1";

const architectureDiagram = `flowchart LR
    U["Browser<br/>Next.js + React"] -->|upload or question| A["FastAPI<br/>modular monolith"]
    A -->|store originals| F[("Local files")]
    A -->|persist chunks + vectors| D[("PostgreSQL + pgvector")]
    A -->|embed chunks + query| E["FastEmbed<br/>BGE-small"]
    E -->|vectors| A
    D -->|retrieve candidates| A
    A -->|numbered evidence| L["Optional LLM"]
    A -->|answer + citations| U`;

const retrievalDiagram = `flowchart LR
    Q["Question"] --> K["Keyword search"]
    Q --> V["Vector search"]
    K --> N["Normalize"]
    V --> N
    N --> H["Weighted hybrid fusion"]
    H --> R["Top evidence"]
    R --> G["Grounded generation"]
    G --> C["Citations + scores"]`;

const sections: GuideSection[] = [
  {
    id: "project",
    number: "01",
    kicker: "Project snapshot",
    title: "What we built",
    summary: "A local-first research workspace that turns mixed documents into inspectable answers.",
    paragraphs: [
      "The user uploads documents, asks questions, and sees the evidence used to answer. The application is a modular monolith: one FastAPI process owns the HTTP routes and RAG services, while PostgreSQL with pgvector is the durable source of truth.",
      "The strongest interview framing is not that the app is an autonomous agent. It is a deterministic, evidence-first RAG pipeline with optional LLM generation and deliberate fallbacks.",
    ],
    bullets: [
      "Implemented: PDF, DOCX, XLSX, PPTX, TXT, Markdown, and CSV ingestion.",
      "Implemented: local BGE-small embeddings, pgvector persistence, HNSW/IVFFlat setup, and hybrid retrieval.",
      "Implemented: citation snippets, retrieval-score breakdowns, LLM citation validation, and deterministic fallback.",
      "Planned: graph visualization, contradiction detection, timeline extraction, OCR, reranking, and agentic routing.",
    ],
    tags: ["FastAPI", "Next.js", "PostgreSQL", "pgvector", "FastEmbed", "OpenAI-compatible LLM"],
  },
  {
    id: "fundamentals",
    number: "02",
    kicker: "First principles",
    title: "RAG fundamentals",
    summary: "Retrieval-Augmented Generation gives a model temporary, traceable memory.",
    paragraphs: [
      "RAG is an application pattern, not a single model. At request time, the application searches an external corpus, selects relevant context, places it in a constrained prompt, and asks a generator to answer from that context.",
      "RAG is useful for private or changing knowledge, large corpora, and answers that need citations. It complements fine-tuning: fine-tuning teaches behavior or style, while RAG supplies current source facts.",
    ],
    bullets: [
      "Prompting shapes behavior but does not add durable knowledge.",
      "Long-context prompting can fit small corpora but is expensive and still needs context selection.",
      "RAG keeps external knowledge updateable, searchable, and auditable.",
      "Fine-tuning is not a reliable database for changing facts.",
    ],
    tags: ["private knowledge", "fresh facts", "grounding", "citations"],
  },
  {
    id: "architecture",
    number: "03",
    kicker: "Trace the system",
    title: "Our architecture",
    summary: "Follow one upload and one question through the actual runtime boundaries.",
    paragraphs: [
      "The browser sends a multipart upload or a chat question to FastAPI. The API writes the original file locally, parses it, chunks the extracted text, creates embeddings, and persists metadata, chunks, and vectors. At query time it retrieves candidates, optionally calls the configured LLM, validates citations, and returns evidence metadata to the UI.",
      "Redis is provisioned in Docker as a future queue seam, but the current code does not enqueue jobs or run workers. That distinction is important in an interview.",
    ],
    bullets: [
      "Current deployment shape: modular monolith, not microservices.",
      "PostgreSQL stores document metadata and chunk records; pgvector stores embeddings.",
      "FastEmbed is a provider used by the API; the API, not FastEmbed, persists vectors.",
      "The UI is an evidence/trust layer: it shows strategy, model, sources, and score breakdowns.",
    ],
    tags: ["modular monolith", "durable state", "clear seams", "local-first"],
  },
  {
    id: "code-tour",
    number: "04",
    kicker: "Read the code",
    title: "Repository code tour",
    summary: "Three execution paths explain the current RAG implementation: format routing, vector persistence, and query retrieval.",
    paragraphs: [
      "Start at the HTTP route, then follow the service and repository call. POST /documents enters api/routes/documents.py::create_document, format-specific extraction lives in services/extraction.py, embeddings live behind services/embeddings.py, and PostgreSQL/pgvector operations live in db.py.",
      "The most important distinction is that format-aware behavior happens during ingestion. A PDF page, XLSX row, or DOCX paragraph becomes annotated chunk text. After that, all formats use the same keyword + vector retrieval pipeline; the current app does not route every format to a different search engine.",
    ],
    bullets: [
      "Format path: create_document → extract_text → format parser → chunk_text → repository.ingest.",
      "Embedding path: ingest → _embed → FastEmbedProvider.embed → vector_literal → document_chunks.embedding + embedding_model.",
      "Query path: chat → retrieve_with_metadata → keyword_search + question embedding + _vector_search → merge_hybrid_results.",
      "Generation is after retrieval: ChatSource citations are created before the optional LLM call.",
      "We did not use LangChain or LangGraph; these are custom services composed by FastAPI routes.",
    ],
    tags: ["documents.py", "extraction.py", "embeddings.py", "retrieval.py", "db.py", "chat.py"],
  },
  {
    id: "ingestion",
    number: "05",
    kicker: "Before search",
    title: "Ingestion and chunking",
    summary: "If structure is lost during ingestion, retrieval cannot recover it later.",
    paragraphs: [
      "The upload route reduces the client name to a basename, validates the extension, streams the file in bounded pieces, enforces RAG_UPLOAD_MAX_BYTES, and stores it under a generated random filename. Extraction runs in a threadpool because the parsers, embedding model, and database driver are synchronous.",
      "The current chunker uses a deterministic 1,200-character window with 200-character overlap and prefers a nearby whitespace boundary. It is a reliable baseline, not the final answer for every document type.",
    ],
    bullets: [
      "PDF: PyMuPDF text extraction with page markers.",
      "DOCX: paragraphs and tables in document order with section/row markers.",
      "XLSX: read-only cached cell values with sheet/row markers; formulas and macros are not executed.",
      "PPTX: slide shapes and table cells with slide markers.",
      "Scanned PDFs and standalone images still need a future OCR/multimodal stage.",
    ],
    tags: ["50 MiB default", "safe filenames", "location context", "overlap"],
  },
  {
    id: "embeddings",
    number: "06",
    kicker: "Representation",
    title: "Embeddings and vector search",
    summary: "Meaning becomes searchable when compatible text is represented in the same vector space.",
    paragraphs: [
      "The app embeds every stored chunk and the user question with BAAI/bge-small-en-v1.5 through FastEmbed. The default model produces 384-dimensional vectors. pgvector uses cosine distance, which the app exposes as a similarity-like vector score.",
      "The provider is lazy: startup does not download a model. Vectors are validated for dimension, finite values, and non-zero norm. Each chunk stores the embedding model name so a model swap cannot silently mix incompatible vectors.",
    ],
    bullets: [
      "HNSW is preferred for approximate nearest-neighbor search; IVFFlat is a practical fallback.",
      "Missing or model-mismatched vectors are treated as stale, not as compatible by accident.",
      "python -m app.reindex repairs missing or stale embeddings without changing source text.",
      "If embedding or vector search fails, keyword retrieval remains available.",
    ],
    tags: ["384 dimensions", "cosine similarity", "HNSW", "model provenance"],
  },
  {
    id: "retrieval",
    number: "07",
    kicker: "Query-time selection",
    title: "Retrieval approaches",
    summary: "Lexical and semantic retrieval cover different failure modes, so the app fuses them.",
    paragraphs: [
      "The current lexical baseline tokenizes the question, removes common stopwords, counts term occurrences in chunks, and ranks by weighted term frequency. It is good for exact names, IDs, dates, and rare phrases.",
      "Vector retrieval is good for paraphrases and conceptual similarity, but can be weaker for exact identifiers, numbers, short queries, and poorly extracted text. Hybrid retrieval keeps both channels eligible, including semantic-only candidates.",
    ],
    bullets: [
      "Keyword score: weighted count of query terms in a candidate chunk.",
      "Keyword normalization: raw score divided by the best keyword candidate score.",
      "Vector score: cosine similarity clamped to a practical 0–1 range.",
      "Default fusion: 0.35 × normalized keyword + 0.65 × vector similarity.",
      "Direct scope answer: yes, the implemented unstructured-document retrieval channels are keyword + vector hybrid search. We did not implement BM25, reranking, query rewriting/decomposition, graph retrieval, SQL/table tools, or an agentic router yet.",
      "These are ranking signals, not calibrated answer confidence.",
    ],
    tags: ["sparse", "dense", "hybrid", "score fusion", "top-k"],
  },
  {
    id: "generation",
    number: "08",
    kicker: "Grounded answers",
    title: "Generation and citations",
    summary: "The provider sees numbered evidence, not the entire corpus, and must cite it.",
    paragraphs: [
      "The optional OpenAI-compatible client sends a system instruction plus the question and numbered retrieved chunks. The prompt treats document text as untrusted source text, forbids outside knowledge, and requires factual statements to include [n] citations.",
      "A response is accepted only when it is non-empty and every cited number is in range. Invalid, malformed, timed-out, or non-2xx provider responses use the deterministic evidence-only fallback. Marker validation is necessary but not sufficient: a production system still needs claim-to-span verification.",
    ],
    bullets: [
      "answer_mode shows whether the response was LLM-generated or deterministic.",
      "answer_provider and answer_model make the provider path visible.",
      "The UI keeps retrieved snippets and channel scores beside the answer.",
      "Prompt grounding reduces hallucination risk but is not a complete security boundary.",
    ],
    tags: ["numbered evidence", "citation validation", "fallback", "abstention"],
  },
  {
    id: "production",
    number: "09",
    kicker: "Beyond the demo",
    title: "Production readiness",
    summary: "Production RAG is a measured system, not a pile of model calls.",
    paragraphs: [
      "Before production, long-running ingestion should move behind an idempotent queue and worker. Originals should live in object storage, and the system should add retries, progress events, dead-letter handling, checksum deduplication, cleanup, and bounded concurrency.",
      "Query-time retrieval should authenticate the user, apply tenant/workspace/ACL filters before search, retrieve lexical and dense candidates, optionally rerank, assemble context, generate, validate, and return a trace. Authorization must never be delegated to the LLM.",
    ],
    bullets: [
      "Measure Recall@k, precision, MRR, nDCG, faithfulness, citation correctness, and abstention quality.",
      "Track p95 latency, embedding throughput, token cost, fallback rate, index freshness, and storage growth.",
      "Add malware scanning, MIME sniffing, quotas, retention, secret management, and audit-safe logging.",
      "Use a golden question set before changing chunking, weights, reranking, or query transformation.",
    ],
    tags: ["ACLs", "evaluation", "observability", "workers", "cost"],
  },
  {
    id: "standout",
    number: "10",
    kicker: "Planned intelligence",
    title: "Graph, timeline, and contradiction features",
    summary: "The standout ideas are planned extensions and should be evidence-backed.",
    paragraphs: [
      "A contradiction detector should extract atomic claims, normalize entities, values, dates, and scopes, then compare claims while retaining both source spans. It should show conflict, support, or not-comparable rather than silently choosing a winner.",
      "A document timeline should distinguish document dates from event dates, effective periods, deadlines, and versions. A knowledge graph should store entities, relationships, claims, source chunk IDs, valid time, and authorization scope.",
    ],
    bullets: [
      "Graph edges should be visually distinguished as directly cited, model-inferred, or user-confirmed.",
      "Timeline events need canonical dates plus the original temporal expression.",
      "A graph database is optional; PostgreSQL tables are enough for an initial evidence-backed graph.",
      "The UI goal is answer claim → citation → exact source span → related entities.",
    ],
    tags: ["claims", "entities", "valid time", "evidence graph"],
  },
  {
    id: "tooling",
    number: "11",
    kicker: "Know your stack",
    title: "Built-in tools versus custom logic",
    summary: "Interviewers care which behavior came from a library and which behavior you designed.",
    paragraphs: [
      "Next.js, React, FastAPI, Pydantic, Starlette, Docker Compose, PostgreSQL, pgvector, psycopg, PyMuPDF, python-docx, openpyxl, python-pptx, FastEmbed, and Python csv provide framework, storage, parsing, and model capabilities.",
      "The custom RAG logic includes supported-format policy, safe file lifecycle, location markers, chunking, embedding validation, model provenance, keyword scoring, weighted fusion, stale-vector reindexing, evidence prompts, citation validation, fallbacks, score metadata, and source deletion quarantine.",
    ],
    bullets: [
      "Redis is provisioned but not currently used by queue or worker code.",
      "A simple custom lexical scorer is used instead of BM25 today.",
      "Reranking, query decomposition, graph retrieval, SQL tools, and OCR are not implemented yet.",
      "The current deployment choice favors learning speed and transparent boundaries.",
    ],
    tags: ["library boundary", "custom policy", "truthful scope"],
  },
  {
    id: "study-plan",
    number: "12",
    kicker: "Zero to hero",
    title: "How to study this project",
    summary: "Learn the system in the same order that a question travels through it.",
    paragraphs: [
      "Start with tokens, embeddings, cosine similarity, sparse versus dense retrieval, context windows, and the difference between RAG and fine-tuning. Then change one system variable at a time and observe the evidence returned by the app.",
      "After the baseline is clear, build a golden set of questions, compare keyword-only, vector-only, and hybrid configurations, and only then add reranking, query transformation, table tools, graph features, or asynchronous workers.",
    ],
    bullets: [
      "Phase 1: fundamentals and a one-document question.",
      "Phase 2: parsing, chunking, metadata, dimensions, and ANN indexes.",
      "Phase 3: BM25, fusion, reranking, Recall@k, MRR, and nDCG.",
      "Phase 4: grounding, citations, structured output, abstention, and injection.",
      "Phase 5: graph/table/multimodal/temporal RAG and safe routing.",
      "Phase 6: queues, authorization, observability, caching, and deployment.",
    ],
    tags: ["learn", "measure", "experiment", "explain"],
  },
];

const interviewCards: InterviewCard[] = ([
  ["What did you build?", "A local-first, multi-format RAG research workspace. It extracts and chunks uploads, creates local embeddings, stores searchable records in PostgreSQL/pgvector, and returns hybrid-retrieval evidence with citations. An optional OpenAI-compatible provider writes the answer, with a deterministic fallback when it cannot.", "Lead with the user outcome, then name the retrieval boundary."],
  ["Why use keyword and vector retrieval together?", "Keyword retrieval is strong for exact names, IDs, dates, and rare phrases. Dense vectors are stronger for paraphrases and conceptual similarity. Hybrid retrieval keeps both signals available instead of forcing every question through one failure mode.", "Give one exact-match example and one paraphrase example."],
  ["How is the hybrid score calculated?", "Keyword scores are normalized by the best keyword candidate, vector similarity is clamped to 0–1, and the channels are fused with configurable weights. The current default is 35% keyword and 65% vector. These are ranking signals, not calibrated confidence.", "Mention that weights should be tuned against an evaluation set."],
  ["What happens when the LLM is unavailable?", "The retrieval path remains useful. The API assembles a deterministic answer from retrieved evidence and exposes answer mode, strategy, sources, and channel scores. A provider failure becomes graceful degradation rather than a 5xx answer failure.", "Separate retrieval failures from generation failures."],
  ["Is this project agentic?", "Not currently. Orchestration is deterministic: keyword retrieval, optional vector retrieval, score fusion, optional grounded generation, citation validation, and fallback. A router for graph, table, timeline, or multi-query tools is planned.", "Be precise about implemented versus proposed."],
  ["How would you make ingestion production-ready?", "Move parsing and embedding behind an idempotent queue, store originals in object storage, add retries and progress events, preserve structural metadata, and make failures observable. Measure the baseline before choosing OCR, structural chunking, or a reranker.", "Tie every upgrade to a measurable failure mode."],
  ["How do you support multiple formats?", "The extraction service dispatches by extension. PyMuPDF handles PDF, python-docx handles DOCX, openpyxl reads XLSX in read-only/data-only mode, python-pptx handles PPTX, and standard Python handles text and CSV. Location markers travel with extracted text.", "Mention page, section, sheet, row, and slide context."],
  ["How do you handle a scanned PDF?", "The current extractor reads the text layer, so a scanned PDF may produce no text and be rejected as empty. OCR is a planned stage; it should preserve page and bounding-box metadata and expose quality checks.", "Do not claim OCR is already implemented."],
  ["Why use chunk overlap?", "Overlap reduces boundary loss. A fact split at the edge of one chunk can still appear in the next. The trade-off is duplicated storage, embedding cost, and redundant candidates.", "Explain the quality versus cost trade-off."],
  ["Why is fixed-character chunking not enough?", "It is a reproducible baseline, but it can split headings, tables, claims, or code arbitrarily. I would compare it with structural and parent-child chunking using a golden set.", "Mention separate structured source spans for citations."],
  ["What happens when a file is too large?", "The upload streams in bounded pieces and is rejected once it exceeds RAG_UPLOAD_MAX_BYTES; the default is 50 MiB. The partial file is removed. Production would also add quotas and scanning.", "State the actual configurable limit."],
  ["How do you prevent path traversal?", "The client filename is reduced to a basename, the stored file gets a random generated name, and resolved paths are checked against the upload root.", "The display name is not a trusted storage path."],
  ["What is the difference between a score and confidence?", "A retrieval score ranks chunks within one configuration. It is not a calibrated probability that the answer is correct. Confidence needs evidence coverage, claim validation, and evaluation.", "The UI calls them score breakdowns, not confidence."],
  ["How do you prevent mixing embedding models?", "Each chunk stores its embedding model name. Vector queries filter by the configured model, and missing or mismatched vectors are stale. The reindex CLI regenerates them.", "Mention dimension and finite-value validation too."],
  ["Why pgvector instead of a separate vector database?", "PostgreSQL already provides durable metadata, transactions, filters, and vector search for this local project. It reduces complexity. A larger deployment should benchmark alternatives against actual workload needs.", "Avoid choosing technology by fashion."],
  ["HNSW or IVFFlat?", "HNSW generally offers strong approximate-neighbor recall and latency with more memory and build cost. IVFFlat uses clusters and needs list tuning. The app prefers HNSW and falls back to IVFFlat.", "Relate the choice to corpus size and update patterns."],
  ["What happens if embeddings fail?", "The provider is best effort. Invalid vectors, model download failure, or vector-query errors leave keyword retrieval usable, and the response reports the fallback strategy.", "This is a deliberate resilience feature."],
  ["Why lazy-load the embedding model?", "It keeps API startup fast and avoids a model download during health checks. The first real ingestion or question pays the load cost, which production can warm up explicitly.", "Explain the startup versus first-request trade-off."],
  ["How do you reduce hallucinations?", "The provider receives only retrieved evidence, is told not to use outside knowledge, must cite numbered sources, and is rejected if citations are missing or out of range. This reduces risk but does not prove faithfulness.", "Grounding is not a guarantee."],
  ["Is prompt grounding a security boundary?", "No. Uploaded text is untrusted and can contain prompt injection. Stronger controls are least privilege, authorization before retrieval, limited tools, output validation, and no secret exposure.", "Treat retrieved content as data, not instructions."],
  ["What if a citation does not support a claim?", "Marker validation only proves that a citation number is in range. The next improvement is claim extraction plus citation-span entailment checks and an abstention path.", "Distinguish citation presence from citation correctness."],
  ["Why keep a deterministic answer mode?", "It enables a local demo without a provider, supplies a retrieval debugging baseline, handles outages, and makes the model path explicit to the user.", "Graceful degradation is a product feature."],
  ["What would you change before production?", "Add authentication and ACL-aware retrieval, async workers, object storage, OCR, structural metadata, reranking, evaluation, observability, quotas, scanning, secret management, retries, and tenant isolation.", "Prioritize by measured risk, not novelty."],
  ["Why is Redis in Compose if it is not used?", "It is the local infrastructure seam for planned background ingestion. The current code is synchronous enough for a learning corpus, so I do not claim Redis workers are implemented.", "Be clear about provisioned versus used infrastructure."],
  ["How would you scale ingestion?", "Store originals in object storage, create a document-version row, enqueue an idempotent job, parse/OCR in workers, batch embeddings, bulk-index chunks, update progress, and retry failures.", "Bound concurrency around CPU and model memory."],
  ["How would you scale query traffic?", "Use stateless APIs, scale retrieval/generation workers, keep search indexed, cache embeddings and safe results, enforce provider rate limits, and stream generation when useful. Authorization remains in the query path.", "Do not cache across authorization scopes."],
  ["How would you test this RAG system?", "Unit-test parsers, chunking, scoring, provider parsing, citation validation, fallback, and deletion. Then use database integration tests, golden retrieval questions, and human or automated faithfulness checks.", "Test malformed files, stale vectors, permissions, and injection text."],
  ["What failure did you deliberately design for?", "A provider failure does not turn into a 5xx answer failure. The API falls back to cited evidence. Vector failure falls back to keyword retrieval, and stale vectors are excluded.", "Name the failure boundary and the user-visible behavior."],
  ["What is current technical debt?", "Chunk metadata is embedded in text rather than rich source-span records; keyword scoring is simple; ingestion is synchronous; there is no auth/ACL layer; and graph, timeline, and conflict features are not implemented.", "Present debt as deliberate next work, not hidden scope."],
  ["What would you measure first if quality were poor?", "First check whether the correct chunk appears in top-k. If not, inspect parsing, chunking, filters, embeddings, weights, and reranking. If it does, inspect prompt assembly, citation validation, and claim faithfulness.", "Separate retrieval failure from generation failure."],
] as const).map(([question, answer, cue]) => ({ question, answer, cue }));

function matchesSection(section: GuideSection, query: string) {
  if (!query) return true;
  const haystack = [section.title, section.kicker, section.summary, ...section.paragraphs, ...(section.bullets || []), ...(section.tags || [])].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function ReferenceLab() {
  const [keyword, setKeyword] = useState(35);
  const vector = 100 - keyword;
  const examples = [
    { label: "Exact launch phrase", k: 0.92, v: 0.48 },
    { label: "Semantic paraphrase", k: 0.32, v: 0.88 },
    { label: "Supporting context", k: 0.61, v: 0.66 },
  ].map((item) => ({ ...item, score: item.k * keyword / 100 + item.v * vector / 100 })).sort((a, b) => b.score - a.score);

  return (
    <div className="reference-lab">
      <div className="reference-lab-controls">
        <label><span>Keyword <strong>{keyword}%</strong></span><input type="range" min="0" max="100" step="5" value={keyword} onChange={(event) => setKeyword(Number(event.target.value))} aria-label="Reference keyword weight" /></label>
        <label><span>Vector <strong>{vector}%</strong></span><input type="range" min="0" max="100" step="5" value={vector} onChange={(event) => setKeyword(100 - Number(event.target.value))} aria-label="Reference vector weight" /></label>
      </div>
      <p className="reference-lab-formula"><code>score = keyword × {keyword / 100} + vector × {vector / 100}</code> · fictional candidates for learning only</p>
      <div className="reference-score-list" aria-live="polite">{examples.map((item, index) => <div className="reference-score-row" key={item.label}><span>{index + 1}</span><strong>{item.label}</strong><i>{item.k.toFixed(2)} KW · {item.v.toFixed(2)} VEC</i><b>{item.score.toFixed(2)}</b></div>)}</div>
    </div>
  );
}

export default function ReferenceGuidePage() {
  const [query, setQuery] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [openQuestions, setOpenQuestions] = useState<number[]>([0]);
  const [storageNotice, setStorageNotice] = useState("");

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || "[]") as unknown;
      if (Array.isArray(stored)) setCompleted(stored.filter((value): value is string => typeof value === "string"));
    } catch {
      setStorageNotice("Progress is available for this visit, but browser storage is unavailable.");
    }
  }, []);

  const filteredSections = useMemo(() => sections.filter((section) => matchesSection(section, query)), [query]);
  const filteredQuestions = useMemo(() => interviewCards.filter((card) => !query || `${card.question} ${card.answer} ${card.cue}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const completedPercent = Math.round((completed.length / sections.length) * 100);

  const toggleComplete = (id: string) => {
    const next = completed.includes(id) ? completed.filter((value) => value !== id) : [...completed, id];
    setCompleted(next);
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      setStorageNotice("");
    } catch {
      setStorageNotice("Progress is available for this visit, but browser storage is unavailable.");
    }
  };

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    window.history.replaceState({}, "", `#${id}`);
  };

  return (
    <main className="study-reference-shell">
      <header className="study-topbar">
        <div className="study-brand-lockup"><div className="study-brand-mark">✦</div><span className="study-brand-name">lumen</span><span className="study-brand-divider" /><span className="study-workspace-name">RAG reference guide</span></div>
        <div className="study-topbar-actions"><span className="reference-top-progress">{completed.length}/{sections.length} sections complete</span><Link href="/study-guide" className="study-back-link">← Interactive Study Lab</Link></div>
      </header>

      <div className="reference-layout">
        <aside className="reference-sidebar" aria-label="Reference guide navigation">
          <div className="reference-side-intro"><p className="eyebrow">Deep reading</p><h2>From zero to interview-ready.</h2><p>Use the lab for exploration and this reference for a complete system explanation.</p></div>
          <label className="reference-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the guide" aria-label="Search the guide" /></label>
          <div className="reference-progress"><div><span>Reading progress</span><strong>{completedPercent}%</strong></div><span className="reference-progress-track"><i style={{ width: `${completedPercent}%` }} /></span></div>
          {storageNotice && <p className="reference-storage-notice" role="status">{storageNotice}</p>}
          <nav className="reference-nav">
            {sections.map((section) => <button key={section.id} type="button" className={filteredSections.some((item) => item.id === section.id) ? "" : "reference-nav-muted"} onClick={() => jumpTo(section.id)}><span>{section.number}</span><strong>{section.title}</strong>{completed.includes(section.id) && <em>✓</em>}</button>)}
            <button type="button" className={!query || filteredQuestions.length > 0 ? "" : "reference-nav-muted"} onClick={() => jumpTo("interview")}><span>13</span><strong>Interview kit</strong></button>
          </nav>
          <Link href="/" className="reference-home-link">← Back to research workspace</Link>
        </aside>

        <section className="reference-main">
          <div className="reference-hero" id="top"><p className="eyebrow">RAG zero-to-hero</p><h1>Understand the system you built.</h1><p>Read the implementation, the trade-offs, the production gaps, and the questions an interviewer is likely to ask. Every “implemented” claim below maps to the current repository.</p><div className="reference-hero-tags"><span>implemented now</span><span>planned next</span><span>interview cues</span></div></div>

          {filteredSections.length === 0 && <div className="reference-empty"><h2>No matching sections</h2><p>Try “embedding”, “citation”, “production”, or “interview”.</p></div>}

          {filteredSections.map((section) => (
            <article className="reference-section" id={section.id} key={section.id}>
              <div className="reference-section-heading"><div><p className="eyebrow">{section.number} · {section.kicker}</p><h2>{section.title}</h2><p className="reference-summary">{section.summary}</p></div><label className={`reference-complete ${completed.includes(section.id) ? "reference-complete-done" : ""}`}><input type="checkbox" checked={completed.includes(section.id)} onChange={() => toggleComplete(section.id)} aria-label={`Mark ${section.title} complete`} /><span>{completed.includes(section.id) ? "Completed" : "Mark complete"}</span></label></div>
              <div className="reference-copy">{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
              {section.tags && <div className="reference-tags">{section.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
              {section.bullets && <ul className="reference-bullets">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
              {section.id === "architecture" && <MermaidDiagram chart={architectureDiagram} label="Runtime architecture of the RAG Research Workspace" />}
              {section.id === "code-tour" && <div className="reference-code-tour"><pre>{`POST /documents\n  → api/routes/documents.py::create_document\n  → services/extraction.py::extract_text\n  → services/extraction.py::chunk_text\n  → db.py::DocumentRepository.ingest\n  → services/embeddings.py::FastEmbedProvider\n  → document_chunks.embedding + embedding_model\n\nPOST /chat\n  → api/routes/chat.py::chat\n  → db.py::retrieve_with_metadata\n  → retrieval.py::keyword_search\n  → db.py::_vector_search\n  → retrieval.py::merge_hybrid_results\n  → generation.py::GroundedAnswerGenerator`}</pre><div><strong>Framework answer</strong><p>This repo does not use LangChain or LangGraph. The RAG orchestration is custom Python code composed by FastAPI routes, with FastEmbed, psycopg, and pgvector providing focused capabilities.</p></div></div>}
              {section.id === "retrieval" && <><MermaidDiagram chart={retrievalDiagram} label="Hybrid retrieval flow" /><ReferenceLab /></>}
              {section.id === "generation" && <div className="reference-evidence-preview"><span>[1]</span><p>Only retrieved evidence is placed in the prompt. The provider must cite the numbered source, and invalid citations trigger deterministic fallback.</p><span>[2]</span></div>}
              {section.id === "production" && <div className="reference-truth-grid"><div><strong>Current</strong><span>local modular monolith</span></div><div><strong>Next</strong><span>queue + worker + ACL filters</span></div><div><strong>Measure</strong><span>Recall@k, faithfulness, p95 latency</span></div></div>}
            </article>
          ))}

          <article className="reference-section reference-interview-section" id="interview">
            <div className="reference-section-heading"><div><p className="eyebrow">13 · Interview kit</p><h2>30 questions to practice out loud.</h2><p className="reference-summary">Answer first, reveal the model answer, then use the cue to sharpen the trade-off.</p></div></div>
            <div className="reference-interview-list">{filteredQuestions.map((card) => { const index = interviewCards.indexOf(card); const open = openQuestions.includes(index); return <article className={`reference-question ${open ? "reference-question-open" : ""}`} key={card.question}><button type="button" onClick={() => setOpenQuestions((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index])} aria-expanded={open}><span>{String(index + 1).padStart(2, "0")}</span><strong>{card.question}</strong><em>{open ? "−" : "+"}</em></button>{open && <div className="reference-answer"><p>{card.answer}</p><div><span>Answer cue</span><strong>{card.cue}</strong></div></div>}</article>; })}</div>
            {filteredQuestions.length === 0 && <p className="reference-no-questions">No interview questions match “{query}”.</p>}
          </article>

          <footer className="reference-footer"><p>Keep this guide honest: retrieval quality is separate from generation quality, scores are not confidence, and implemented behavior must stay distinct from planned architecture.</p><Link href="/study-guide">Return to the interactive Study Lab →</Link></footer>
        </section>

        <aside className="reference-rail" aria-label="Reference guide reminders"><div className="reference-rail-card reference-rail-highlight"><p className="eyebrow">The sentence to remember</p><h3>Retrieval is the hard quality boundary.</h3><p>If the relevant evidence never enters the candidate set, the generator cannot reliably recover it.</p></div><div className="reference-rail-card"><p className="eyebrow">Implemented now</p><ul><li>7 document formats</li><li>local BGE embeddings</li><li>hybrid keyword + vector retrieval</li><li>citation validation + fallback</li></ul></div><div className="reference-rail-card reference-rail-next"><p className="eyebrow">Planned next</p><ul><li>OCR and multimodal parsing</li><li>reranking and evaluation</li><li>ACL-aware retrieval</li><li>graph, timeline, contradictions</li></ul></div></aside>
      </div>
    </main>
  );
}
