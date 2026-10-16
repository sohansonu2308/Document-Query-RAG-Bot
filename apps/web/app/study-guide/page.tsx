"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import MermaidDiagram from "./MermaidDiagram";

type LessonId =
  | "start"
  | "fundamentals"
  | "architecture"
  | "code-tour"
  | "ingestion"
  | "retrieval"
  | "generation"
  | "production"
  | "interview";

type Lesson = {
  id: LessonId;
  number: string;
  label: string;
  duration: string;
  description: string;
};

const lessons: Lesson[] = [
  { id: "start", number: "01", label: "Start here", duration: "4 min", description: "The product in one mental model" },
  { id: "fundamentals", number: "02", label: "RAG fundamentals", duration: "7 min", description: "Why retrieval changes the answer" },
  { id: "architecture", number: "03", label: "Our architecture", duration: "8 min", description: "Follow a question through the system" },
  { id: "code-tour", number: "04", label: "Code tour", duration: "10 min", description: "Read the repo path end to end" },
  { id: "ingestion", number: "05", label: "Ingestion", duration: "9 min", description: "Turn files into searchable evidence" },
  { id: "retrieval", number: "06", label: "Retrieval lab", duration: "8 min", description: "Tune keyword and vector signals" },
  { id: "generation", number: "07", label: "Generation & citations", duration: "6 min", description: "Keep answers grounded and traceable" },
  { id: "production", number: "08", label: "Production readiness", duration: "8 min", description: "Know what ships and what comes next" },
  { id: "interview", number: "09", label: "Interview kit", duration: "10 min", description: "Practice the reasoning out loud" },
];

const STORAGE_KEY = "lumen-rag-study-progress-v1";

const architectureDiagram = `flowchart LR
    U["Browser<br/>Next.js + React"] -->|upload or question| A["FastAPI<br/>modular monolith"]
    A -->|store originals| F[("Local files")]
    A -->|persist metadata, chunks, vectors| D[("PostgreSQL + pgvector")]
    A -->|embed chunks and query| E["FastEmbed<br/>BGE-small"]
    E -->|vectors| A
    D -->|retrieve candidates| A
    A -->|numbered evidence| L["Optional LLM"]
    A -->|answer + citations + scores| U`;

const retrievalDiagram = `flowchart LR
    Q["Question"] --> K["Keyword search"]
    Q --> V["Vector search"]
    K --> N["Normalize"]
    V --> N
    N --> H["Hybrid score<br/>weighted fusion"]
    H --> C["Top evidence"]
    C --> G["Grounded answer"]
    G --> S["Citations + scores"]`;

const implementedNow = [
  "Seven supported document formats",
  "Overlapping chunks with text location context",
  "PostgreSQL + pgvector persistence",
  "Keyword + vector hybrid retrieval",
  "Citation snippets and score breakdowns",
  "Deterministic fallback when a provider is unavailable",
];

const plannedNext = [
  "Structural chunks and a reranker",
  "OCR, image understanding, and table tools",
  "Async ingestion workers with retries",
  "Evaluation sets, traces, and quality dashboards",
  "ACL-aware retrieval and multi-tenant isolation",
];

const interviewCards = [
  {
    question: "What did you build?",
    answer: "A local-first, multi-format RAG research workspace. It extracts and chunks uploads, creates local embeddings, stores searchable records in PostgreSQL/pgvector, and returns hybrid-retrieval evidence with citations. An optional OpenAI-compatible provider can write the answer, with a deterministic fallback when it cannot.",
    cue: "Lead with the user outcome, then name the retrieval boundary.",
  },
  {
    question: "Why use keyword and vector retrieval together?",
    answer: "Keyword retrieval is strong for exact names, IDs, dates, and rare phrases. Dense vectors are stronger for paraphrases and conceptual similarity. Hybrid retrieval keeps both signals available instead of forcing every question through one failure mode.",
    cue: "Give one exact-match example and one paraphrase example.",
  },
  {
    question: "How is the hybrid score calculated?",
    answer: "Keyword scores are normalized by the best keyword candidate, vector similarity is clamped to a practical 0–1 range, and the channels are fused with configurable weights. The current default is 35% keyword and 65% vector. Those are ranking signals, not calibrated confidence.",
    cue: "Mention that weights should be tuned against an evaluation set.",
  },
  {
    question: "What happens when the LLM is unavailable?",
    answer: "The retrieval path remains useful. The API uses a deterministic answer assembled from the retrieved evidence and exposes the answer mode, strategy, sources, and channel scores. A provider failure is therefore a graceful degradation path rather than a 5xx answer failure.",
    cue: "Separate retrieval failures from generation failures.",
  },
  {
    question: "Is this project agentic?",
    answer: "Not currently. The orchestrator is deterministic: keyword retrieval, optional vector retrieval, score fusion, optional grounded generation, then citation validation and fallback. A router for graph, table, timeline, or multi-query tools is a planned extension.",
    cue: "Be precise about what is implemented versus proposed.",
  },
  {
    question: "How would you make ingestion production-ready?",
    answer: "Move long-running parsing and embedding work behind an idempotent queue, store originals in object storage, add retries and progress events, preserve structural metadata, and make failures observable. Then measure the baseline before choosing OCR, structural chunking, or a reranker.",
    cue: "Tie every upgrade to a measurable failure mode.",
  },
];

function SparkleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="study-icon study-sparkle-icon">
      <path d="m12 2 1.55 6.45L20 10l-6.45 1.55L12 18l-1.55-6.45L4 10l6.45-1.55L12 2Z" />
      <path d="m19 16 .68 2.32L22 19l-2.32.68L19 22l-.68-2.32L16 19l2.32-.68L19 16Z" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="study-icon">
      {direction === "left" ? <path d="m14.5 5-7 7 7 7M8 12h11" /> : <path d="m9.5 5 7 7-7 7M16 12H5" />}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="study-icon">
      <path d="m5 12.5 4.3 4.2L19 7" />
    </svg>
  );
}

function StatusPanel({ type, items }: { type: "now" | "next"; items: string[] }) {
  const isNow = type === "now";
  return (
    <section className={`status-panel status-panel-${type}`}>
      <div className="status-panel-heading">
        <span className="status-icon">{isNow ? <CheckIcon /> : "→"}</span>
        <div>
          <p className="card-kicker">Status</p>
          <h3>{isNow ? "Implemented now" : "Planned next"}</h3>
        </div>
      </div>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

function StartLesson() {
  const stages = [
    ["01", "Ingest", "Accept a source, parse its format, and preserve where text came from."],
    ["02", "Index", "Chunk the normalized text, embed each chunk, and persist searchable records."],
    ["03", "Retrieve", "Run lexical and semantic search, then merge the candidate evidence."],
    ["04", "Generate", "Answer from numbered evidence and expose citations back to the user."],
  ];

  return (
    <>
      <div className="lesson-intro-grid">
        <section className="lesson-card lesson-card-feature">
          <p className="card-kicker">Core idea</p>
          <h2>RAG gives a model a temporary, traceable memory.</h2>
          <p>Retrieval-Augmented Generation does not ask a model to memorize every source. The application finds relevant context at request time, places that context in a constrained prompt, and returns the evidence alongside the answer.</p>
          <div className="formula-callout"><span>question</span><b>→</b><span>evidence</span><b>→</b><span>grounded answer</span></div>
        </section>
        <section className="lesson-card lesson-card-warm">
          <p className="card-kicker">Use this guide</p>
          <h2>Learn the boundary before the buzzwords.</h2>
          <p>Move left to right when you want the system story. Use the lab to see why a hybrid rank can change as the weights change. The final module turns those concepts into honest interview language.</p>
           <div className="micro-meta"><span className="meta-dot" /> Local-only learning state <span>·</span> 9 short modules</div>
        </section>
      </div>

      <div className="section-heading-row">
        <div><p className="card-kicker">The mental model</p><h2>Four stages + explicit evaluation.</h2></div>
        <p>Generation cannot recover evidence that retrieval never found; evaluation closes the loop.</p>
      </div>
      <div className="stage-grid">
        {stages.map(([number, title, body]) => (
          <article className="stage-card" key={number}>
            <span className="stage-number">{number}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
      <div className="stage-evaluation"><span>05</span><div><strong>Evaluate + operate</strong><p>Measure retrieval recall, answer faithfulness, latency, cost, and failure modes against a representative set.</p></div><em>closes the loop</em></div>

      <div className="status-grid">
        <StatusPanel type="now" items={implementedNow.slice(0, 4)} />
        <StatusPanel type="next" items={plannedNext.slice(0, 4)} />
      </div>
      <div className="truth-callout"><span>i</span><p><strong>Interview truth rule:</strong> describe the deterministic hybrid pipeline as implemented. Graph views, contradiction detection, OCR, and agentic routing are learning milestones—not current claims.</p></div>
    </>
  );
}

function FundamentalsLesson() {
  const approaches = [
    ["Prompting", "Shape behavior and format", "It does not add durable, private knowledge."],
    ["Long context", "Fit a small complete corpus", "It is expensive and still needs context selection."],
    ["RAG", "Search fresh, private evidence", "Retrieval quality becomes a core engineering problem."],
    ["Fine-tuning", "Teach style and behavior", "It is not a reliable store for changing facts."],
  ];
  return (
    <>
      <section className="lesson-card lesson-card-wide">
        <div className="card-kicker">A useful definition</div>
        <h2>RAG is an application pattern, not a single model.</h2>
        <p className="lede">The model's parameters are only one source of knowledge. Your application assembles a temporary context window from a searchable corpus, then asks the generator to stay inside that evidence.</p>
        <div className="definition-strip"><span>Private knowledge</span><span>Fresh facts</span><span>Auditable context</span><span>Permission-aware retrieval</span></div>
      </section>
      <div className="section-heading-row compact-heading"><div><p className="card-kicker">Choose the right tool</p><h2>RAG complements the alternatives.</h2></div></div>
      <div className="approach-grid">
        {approaches.map(([title, bestFor, tradeoff]) => (
          <article className={`approach-card ${title === "RAG" ? "approach-card-active" : ""}`} key={title}>
            <span className="approach-label">{title}</span>
            <h3>{bestFor}</h3>
            <p>{tradeoff}</p>
          </article>
        ))}
      </div>
      <section className="lesson-card lesson-card-outline fundamentals-loop">
        <div><p className="card-kicker">Four stages + evaluation</p><h2>Quality is also an operations problem.</h2></div>
        <div className="loop-list">
          {[["01", "Ingestion", "Accept, validate, parse, and annotate."], ["02", "Indexing", "Chunk, embed, and persist."], ["03", "Retrieval", "Select and rank evidence."], ["04", "Generation", "Answer with citations."], ["05", "Evaluation + operations", "Measure quality, latency, cost, and failure."]].map(([number, title, text]) => <div className="loop-row" key={number}><span>{number}</span><strong>{title}</strong><p>{text}</p></div>)}
        </div>
      </section>
    </>
  );
}

function ArchitectureLesson() {
  return (
    <>
      <section className="lesson-card lesson-card-wide">
        <div className="card-kicker">Read the system</div>
        <h2>A modular monolith with clear seams.</h2>
        <p className="lede">The browser talks to one FastAPI process. That process owns upload routes, extraction, embeddings, retrieval, and generation while PostgreSQL remains the durable source of truth. The boundaries are explicit even though the deployment is intentionally simple.</p>
        <div className="architecture-tags"><span>Next.js UI</span><span>FastAPI API</span><span>PostgreSQL + pgvector</span><span>Optional provider</span></div>
      </section>
      <MermaidDiagram chart={architectureDiagram} label="Runtime architecture: browser, API, local files, embeddings, database, and optional provider" />
      <div className="architecture-grid">
        {[
          ["Browser", "Uploads, asks questions, and renders the evidence-first trust layer.", "implemented"],
          ["FastAPI", "Orchestrates retrieve → generate → validate without becoming an autonomous agent.", "implemented"],
          ["PostgreSQL", "Stores metadata, chunks, model provenance, and vectors through pgvector.", "implemented"],
          ["Redis workers", "Provisioned as a future queue seam; no background ingestion code uses it yet.", "planned"],
        ].map(([title, body, status]) => <article className={`architecture-node architecture-node-${status}`} key={title}><div className="node-topline"><span className="node-dot" /><span>{status === "implemented" ? "now" : "next"}</span></div><h3>{title}</h3><p>{body}</p></article>)}
      </div>
      <div className="truth-callout"><span>↗</span><p><strong>Architecture cue:</strong> “Modular monolith” is a strength for local development here: one process, typed contracts, and seams that can later split without changing the conceptual flow.</p></div>
    </>
  );
}

function CodeTourLesson() {
  type CodeTourTab = "formats" | "embeddings" | "retrieval";
  const [activeTab, setActiveTab] = useState<CodeTourTab>("formats");
  const tabs: { id: CodeTourTab; label: string; caption: string }[] = [
    { id: "formats", label: "1 · Format routing", caption: "How an upload becomes searchable text" },
    { id: "embeddings", label: "2 · Embeddings + storage", caption: "How vectors are created and persisted" },
    { id: "retrieval", label: "3 · Query retrieval", caption: "How a question becomes ranked evidence" },
  ];

  const tabContent: Record<CodeTourTab, { title: string; explanation: string; steps: string[]; code: string }> = {
    formats: {
      title: "The extension chooses the parser during ingestion",
      explanation: "The important nuance: document format changes extraction and citation metadata, not the later search algorithm. After extraction, PDF, XLSX, DOCX, and text chunks enter the same keyword + vector retrieval pool.",
      steps: [
        "POST /documents enters apps/api/app/api/routes/documents.py::create_document.",
        "The extension is checked against SUPPORTED_EXTENSIONS and the file is saved with a generated filename.",
        "services/extraction.py::extract_text dispatches to _extract_pdf, _extract_docx, _extract_xlsx, _extract_pptx, CSV parsing, or UTF-8 decoding.",
        "The extractor adds location context such as [PDF page 3] or [XLSX sheet Roadmap, row 12].",
        "chunk_text normalizes the extracted text into overlapping chunks before persistence.",
      ],
      code: `# apps/api/app/services/extraction.py\nsuffix = Path(filename).suffix.lower()\nif suffix in {".pdf", ".docx", ".xlsx", ".pptx"}:\n    return {\n        ".pdf": _extract_pdf,\n        ".docx": _extract_docx,\n        ".xlsx": _extract_xlsx,\n        ".pptx": _extract_pptx,\n    }[suffix](content)\n\n# After this, every format follows the same\n# normalize → chunk → embed → persist path.`,
    },
    embeddings: {
      title: "Chunks become 384-dimensional vectors",
      explanation: "The repository asks the configured EmbeddingProvider to embed each chunk. FastEmbed loads BAAI/bge-small-en-v1.5 lazily. The API serializes valid vectors for pgvector and stores the model name beside each vector.",
      steps: [
        "db.py::DocumentRepository.ingest calls chunk_text and then self._embed(chunks).",
        "services/embeddings.py::FastEmbedProvider loads the model only on the first real embedding call.",
        "The database enables the vector extension and creates document_chunks.embedding vector(384).",
        "Each chunk row stores embedding and embedding_model; invalid, wrong-dimension, or zero-norm vectors are rejected.",
        "The HNSW cosine index accelerates nearest-neighbor search; IVFFlat is the fallback if HNSW is unavailable.",
      ],
      code: `# apps/api/app/db.py\nchunks = chunk_text(extracted_text, self.chunk_size, self.chunk_overlap)\nembeddings = self._embed(chunks)\n\n# simplified insert shape\nINSERT INTO document_chunks\n    (id, document_id, chunk_index, text, embedding, embedding_model)\nVALUES\n    (..., ..., ..., ..., %s::vector, %s)`,
    },
    retrieval: {
      title: "The chat route fuses two retrieval channels",
      explanation: "POST /chat does not call LangChain or LangGraph. chat.py calls the repository directly. The repository runs the custom keyword scorer, embeds the question, runs a pgvector cosine query for the current model, and merges both result sets.",
      steps: [
        "api/routes/chat.py::chat calls repository.retrieve_with_metadata(question, top_k).",
        "services/retrieval.py::keyword_search scores ready chunks by token counts after stopword removal.",
        "db.py embeds the question and _vector_search returns nearest chunks tagged with the current model.",
        "merge_hybrid_results normalizes keyword scores, clamps vector scores, and applies the configured weights (0.35 / 0.65 by default).",
        "The top hits become ChatSource citations; only then does generation.py attempt the optional LLM call.",
      ],
      code: `# apps/api/app/services/retrieval.py\nnormalized_keyword = keyword_score / max_keyword\nnormalized_vector = max(0.0, min(1.0, vector_score))\nscore = (keyword_weight * normalized_keyword\n         + vector_weight * normalized_vector)\n\n# Retrieval is custom application code:\n# keyword + pgvector + weighted fusion.`,
    },
  };
  const active = tabContent[activeTab];

  return (
    <>
      <section className="lesson-card lesson-card-wide code-tour-hero">
        <div className="card-kicker">Read the repository in execution order</div>
        <h2>Understand the code path, not just the architecture diagram.</h2>
        <p className="lede">Start with the route, follow the service call, inspect the database write or search, and then separate what our code owns from what a library provides.</p>
        <div className="code-tour-truth"><span>Important</span><p>Format-aware behavior currently happens during ingestion. Once chunks are stored, all supported formats use the same keyword + vector retrieval pipeline.</p></div>
      </section>

      <section className="repo-tree-card">
        <div className="card-kicker">Repository map</div>
        <h3>Where to look first</h3>
        <pre className="repo-tree">{`apps/api/app/
├─ api/routes/documents.py  upload → extract → ingest → delete
├─ api/routes/chat.py       retrieve → generate → cite
├─ services/extraction.py   format parsers + chunk_text
├─ services/embeddings.py   EmbeddingProvider + FastEmbed
├─ services/retrieval.py    keyword_search + score fusion
├─ services/generation.py   optional LLM + deterministic fallback
├─ db.py                    PostgreSQL/pgvector repository
├─ schemas.py               typed HTTP contracts
└─ reindex.py               repair stale or missing vectors

apps/web/app/page.tsx       upload/chat/evidence UI
apps/web/app/study-guide/   interactive learning UI`}</pre>
      </section>

      <div className="code-tour-tabs" role="tablist" aria-label="Code walkthrough topics">
        {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "code-tour-tab-active" : ""} onClick={() => setActiveTab(tab.id)}><strong>{tab.label}</strong><span>{tab.caption}</span></button>)}
      </div>

      <section className="code-tour-panel" role="tabpanel">
        <div className="code-tour-panel-copy"><p className="card-kicker">{tabs.find((tab) => tab.id === activeTab)?.caption}</p><h3>{active.title}</h3><p>{active.explanation}</p><ol>{active.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
        <pre className="code-snippet"><code>{active.code}</code></pre>
      </section>

      <div className="status-grid"><StatusPanel type="now" items={["Custom format dispatch during ingestion", "FastEmbed provider seam", "PostgreSQL/pgvector vector persistence", "Custom keyword + vector score fusion"]} /><StatusPanel type="next" items={["Route table questions to safe calculations", "Add structural source-span records", "Add reranking and evaluation traces", "Add a graph/timeline/contradiction router"]} /></div>
    </>
  );
}

function IngestionLesson() {
  const pipeline = ["Validate", "Extract", "Normalize", "Chunk", "Embed", "Persist"];
  const formats = [["PDF", "page text", "page marker"], ["DOCX", "paragraphs + tables", "section / row"], ["XLSX", "cached cells", "sheet / row"], ["PPTX", "shapes + tables", "slide"], ["TXT / MD", "UTF-8 text", "source text"], ["CSV", "rows → pipes", "row context"]];
  return (
    <>
      <section className="lesson-card lesson-card-wide">
        <div className="card-kicker">Before search</div>
        <h2>Good retrieval starts with preserving structure.</h2>
        <p className="lede">The ingestion boundary validates the file, extracts text with format-specific location context, normalizes it, and creates overlapping chunks. Markers are text annotations rather than a separate citation-location table, so a marker can be split or lost at a chunk boundary.</p>
        <div className="pipeline-row">{pipeline.map((step, index) => <div className="pipeline-step" key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < pipeline.length - 1 && <b>→</b>}</div>)}</div>
      </section>
      <div className="section-heading-row compact-heading"><div><p className="card-kicker">Location-aware extraction</p><h2>Every format carries different context.</h2></div><span className="small-note">Text markers can be lost across chunks.</span></div>
      <div className="format-table-wrap">
        <table className="format-table"><caption className="sr-only">Supported formats and typical location context</caption><thead><tr><th>Format</th><th>Extraction shape</th><th>Typical location context</th></tr></thead><tbody>{formats.map(([format, shape, marker]) => <tr key={format}><th scope="row">{format}</th><td>{shape}</td><td><span className="table-marker">{marker}</span></td></tr>)}</tbody></table>
      </div>
      <div className="chunking-grid">
        <section className="lesson-card lesson-card-outline"><p className="card-kicker">Current baseline</p><h3>1,200 character window</h3><p>Chunks overlap by 200 characters and prefer a nearby whitespace boundary. The overlap reduces the chance that a fact split at an edge disappears from the next result.</p><div className="chunk-visual"><span>chunk 1</span><span>shared overlap</span><span>chunk 2</span></div></section>
        <section className="lesson-card lesson-card-warm"><p className="card-kicker">Planned upgrade</p><h3>Structure first, size second</h3><p>Compare structural or parent-child chunks against the baseline using a golden set. Keep page, section, slide, and cell metadata separate from searchable text for precise citations.</p><span className="status-badge status-badge-planned">planned next</span></section>
      </div>
    </>
  );
}

type RetrievalExample = {
  label: string;
  keywordRaw: number;
  vectorCosine: number;
  hint: string;
};

const retrievalExamples: RetrievalExample[] = [
  { label: "Exact launch phrase", keywordRaw: 9, vectorCosine: 0.48, hint: "rare terms reward lexical search" },
  { label: "Semantic paraphrase", keywordRaw: 3, vectorCosine: 0.88, hint: "meaning can win without exact overlap" },
  { label: "Supporting context", keywordRaw: 6, vectorCosine: 0.66, hint: "balanced signals stay competitive" },
];

function RetrievalLab() {
  const [keywordWeight, setKeywordWeight] = useState(35);
  const vectorWeight = 100 - keywordWeight;
  const keywordWeightFraction = keywordWeight / 100;
  const vectorWeightFraction = vectorWeight / 100;
  const maxKeywordRaw = Math.max(...retrievalExamples.map((example) => example.keywordRaw));
  const clampCosine = (score: number) => Math.min(1, Math.max(0, score));
  const rankedExamples = useMemo(() => retrievalExamples.map((example) => ({
    ...example,
    keywordScore: maxKeywordRaw > 0 ? example.keywordRaw / maxKeywordRaw : 0,
    vectorScore: clampCosine(example.vectorCosine),
    score: (maxKeywordRaw > 0 ? example.keywordRaw / maxKeywordRaw : 0) * keywordWeightFraction + clampCosine(example.vectorCosine) * vectorWeightFraction,
  })).sort((a, b) => b.score - a.score), [keywordWeightFraction, maxKeywordRaw, vectorWeightFraction]);

  return (
    <>
      <section className="lesson-card lesson-card-wide retrieval-lab-card">
        <div className="lab-heading"><div><div className="card-kicker">Hands-on lab</div><h2>Make the weighting trade-off visible.</h2></div><span className="lab-live"><span /> live calculation</span></div>
        <p className="lede">Move the coupled sliders to see the same three fictional candidate chunks re-rank. This illustrates the implemented fusion shape without calling an API or changing backend configuration.</p>
        <div className="lab-notice"><strong>Fictional examples</strong><span>·</span><p>Raw keyword counts and cosine-like scores below are illustrative only. The UI keeps the two weights complementary so the total is always 1; the backend weights are configured independently and a zero total is invalid.</p></div>
        <div className="retrieval-controls">
          <label className="weight-control"><span><strong>Keyword weight</strong><output>{keywordWeight}%</output></span><input type="range" min="0" max="100" step="5" value={keywordWeight} onChange={(event) => setKeywordWeight(Number(event.target.value))} aria-label="Keyword retrieval weight" /><small>Exact terms, IDs, dates, rare phrases</small></label>
          <label className="weight-control weight-control-vector"><span><strong>Vector weight</strong><output>{vectorWeight}%</output></span><input type="range" min="0" max="100" step="5" value={vectorWeight} onChange={(event) => setKeywordWeight(100 - Number(event.target.value))} aria-label="Vector retrieval weight" /><small>Paraphrases and conceptual similarity</small></label>
        </div>
        <div className="lab-formula"><code>hybrid = keywordWeight × (rawKeyword / maxKeyword) + vectorWeight × clamp(cosine, 0, 1)</code><span>Default: 0.35 × keyword + 0.65 × vector</span></div>
        <div className="weight-summary"><span>Coupled UI blend</span><strong>{keywordWeight}% keyword</strong><b>+</b><strong>{vectorWeight}% vector</strong><span className="weight-summary-note">Scores rank evidence; they are not confidence.</span><button type="button" className="restore-defaults-button" onClick={() => setKeywordWeight(35)}>Restore defaults</button></div>
        <div className="score-list" aria-live="polite">
          {rankedExamples.map((example, index) => (
            <article className="score-row" key={example.label}>
              <div className="score-row-rank">{index + 1}</div>
              <div className="score-row-main"><div className="score-row-title"><strong>{example.label}</strong><span>{example.hint} · raw keyword count {example.keywordRaw}</span></div><div className="score-bars"><div className="score-bar-line"><span>KW</span><div className="score-track"><i className="score-fill score-fill-keyword" style={{ width: `${example.keywordScore * 100}%` }} /></div><b>{example.keywordScore.toFixed(2)}</b></div><div className="score-bar-line"><span>VEC</span><div className="score-track"><i className="score-fill score-fill-vector" style={{ width: `${example.vectorScore * 100}%` }} /></div><b>{example.vectorScore.toFixed(2)}</b></div></div></div>
              <div className="combined-score"><span>combined</span><strong>{example.score.toFixed(2)}</strong></div>
            </article>
          ))}
        </div>
      </section>
      <MermaidDiagram chart={retrievalDiagram} label="Retrieval flow: keyword and vector channels merge into ranked evidence and citations" />
       <div className="retrieval-notes"><section className="lesson-card lesson-card-outline"><p className="card-kicker">Exact matches</p><h3>Keyword retrieval</h3><p>Useful for product codes, legal phrases, names, dates, and other terms where “close enough” meaning may be the wrong result.</p></section><section className="lesson-card lesson-card-outline"><p className="card-kicker">Meaning matches</p><h3>Vector retrieval</h3><p>Useful when a question and source express the same idea with different words. It can still struggle with short queries, identifiers, and domain language.</p></section></div>
       <div className="truth-callout"><span>i</span><p><strong>Current retrieval scope:</strong> yes, our implemented unstructured-document retrieval is custom keyword + pgvector vector hybrid search. BM25, reranking, query rewriting, graph/table retrieval, and agentic routing are not implemented yet.</p></div>
    </>
  );
}

function GenerationLesson() {
  const answerSteps = [["1", "Retrieve", "Select the top evidence chunks."], ["2", "Constrain", "Send numbered evidence, not the whole corpus."], ["3", "Generate", "Ask for concise claims with [n] markers."], ["4", "Validate", "Reject missing or out-of-range citations."], ["5", "Fallback", "Use an evidence-only answer when needed."]];
  return (
    <>
      <section className="lesson-card lesson-card-wide">
        <div className="card-kicker">Grounded generation</div>
        <h2>An answer is only as trustworthy as its evidence path.</h2>
        <p className="lede">The optional provider sees the question plus numbered retrieved evidence. The API checks the response for usable, in-range citations; the UI makes the answer mode and retrieval metadata visible instead of hiding the boundary.</p>
        <div className="answer-pipeline">{answerSteps.map(([number, title, text]) => <div className="answer-step" key={number}><span>{number}</span><strong>{title}</strong><p>{text}</p></div>)}</div>
      </section>
      <div className="generation-grid">
        <section className="answer-preview-card">
          <div className="preview-topline"><span className="preview-label"><SparkleIcon /> grounded answer</span><span className="answer-mode-chip">citation checked</span></div>
          <p>The selected claim is supported by the retrieved evidence <mark>[1]</mark>. A second passage provides corroborating context <mark>[2]</mark>.</p>
          <div className="preview-sources"><span><b>[1]</b> retrieved chunk</span><span><b>[2]</b> retrieved chunk</span></div>
        </section>
        <section className="lesson-card lesson-card-warm">
          <p className="card-kicker">Important distinction</p>
          <h3>A citation marker is necessary, not sufficient.</h3>
          <p>Checking that <code>[2]</code> exists does not prove the passage supports the claim. A production system should add claim-to-span checks, structured output, trace IDs, and an abstention path.</p>
          <span className="status-badge status-badge-planned">claim-level verification · next</span>
        </section>
      </div>
      <div className="status-grid"><StatusPanel type="now" items={["Numbered evidence prompt", "Citation marker validation", "Deterministic answer mode", "Visible answer and retrieval metadata"]} /><StatusPanel type="next" items={["Claim-to-span entailment checks", "Prompt-injection-resistant tool policy", "Structured answers and abstention", "Provider cost and latency tracing"]} /></div>
    </>
  );
}

function ProductionLesson() {
  const safeguards = [["Access", "Tenant, workspace, and ACL filters belong in retrieval."], ["Reliability", "Retries, idempotency, backpressure, and clear fallbacks keep failure bounded."], ["Quality", "Golden questions measure Recall@k, MRR, faithfulness, and citation correctness."], ["Operations", "Trace latency, token cost, index freshness, and provider fallback rate."], ["Data", "Use object storage, malware scanning, retention rules, and secret management."]];
  return (
    <>
      <section className="lesson-card lesson-card-wide production-hero-card">
        <div className="lab-heading"><div><div className="card-kicker">From demo to dependable system</div><h2>Production readiness is a sequence of measurable upgrades.</h2></div><span className="readiness-score"><strong>baseline</strong><span>usable locally</span></span></div>
        <p className="lede">The current app is an honest learning baseline: synchronous ingestion, deterministic orchestration, local persistence, and visible fallback paths. The next step is not “add an agent”; it is measure where this baseline breaks.</p>
        <div className="readiness-note"><span className="readiness-note-dot" /><p><strong>Current posture:</strong> usable local baseline. The next milestone is evidence from measured recall, latency, cost, and failure rates—not a guessed readiness percentage.</p></div>
      </section>
      <div className="safeguard-grid">{safeguards.map(([title, body], index) => <article className="safeguard-card" key={title}><span className="safeguard-number">0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
      <div className="status-grid"><StatusPanel type="now" items={["Local-first source storage", "Configurable upload boundary", "Hybrid retrieval baseline", "Visible fallback and citations"]} /><StatusPanel type="next" items={["Async queue + worker progress", "Golden evaluation set", "ACL-aware multi-tenant retrieval", "Observability, quotas, and scanning"]} /></div>
      <div className="truth-callout"><span>i</span><p><strong>Good production judgment:</strong> benchmark recall, latency, cost, and failure rates at realistic scale before selecting a vector database, reranker, query transformation, or agentic router.</p></div>
    </>
  );
}

function InterviewKit() {
  const [openCards, setOpenCards] = useState<Set<number>>(new Set([0]));
  const toggleCard = (index: number) => {
    setOpenCards((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };
  return (
    <>
      <section className="lesson-card lesson-card-wide interview-hero-card">
        <div className="card-kicker">Practice the reasoning</div>
        <h2>Specific, measured, and honest beats impressive-sounding.</h2>
        <p className="lede">Open a question, answer it in your own words, then use the cue to sharpen the trade-off. The strongest explanation keeps a clean line between the code that exists and the milestone you would measure next.</p>
        <div className="interview-rule"><span>implemented</span><b>≠</b><span>planned</span><b>→</b><span>measured next</span></div>
      </section>
      <div className="flashcard-list">
        {interviewCards.map((card, index) => {
          const isOpen = openCards.has(index);
          return <article className={`flashcard ${isOpen ? "flashcard-open" : ""}`} key={card.question}><button type="button" className="flashcard-question" aria-expanded={isOpen} onClick={() => toggleCard(index)}><span className="flashcard-index">{String(index + 1).padStart(2, "0")}</span><span>{card.question}</span><span className="flashcard-toggle" aria-hidden="true">{isOpen ? "−" : "+"}</span></button>{isOpen && <div className="flashcard-answer"><p>{card.answer}</p><div className="flashcard-cue"><span>Answer cue</span><strong>{card.cue}</strong></div></div>}</article>;
        })}
      </div>
      <div className="truth-callout"><span>✓</span><p><strong>Before you finish:</strong> explain why retrieval is the hard quality boundary, how the fallback works, and one concrete upgrade you would validate with an evaluation set.</p></div>
    </>
  );
}

function LessonContent({ lessonId }: { lessonId: LessonId }) {
  switch (lessonId) {
    case "fundamentals": return <FundamentalsLesson />;
    case "architecture": return <ArchitectureLesson />;
    case "code-tour": return <CodeTourLesson />;
    case "ingestion": return <IngestionLesson />;
    case "retrieval": return <RetrievalLab />;
    case "generation": return <GenerationLesson />;
    case "production": return <ProductionLesson />;
    case "interview": return <InterviewKit />;
    default: return <StartLesson />;
  }
}

function readProgress(): Partial<Record<LessonId, boolean>> {
  if (typeof window === "undefined") return {};
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return {};
    return stored.reduce<Partial<Record<LessonId, boolean>>>((progress, value) => {
      if (typeof value === "string" && lessons.some((lesson) => lesson.id === value)) progress[value as LessonId] = true;
      return progress;
    }, {});
  } catch {
    return {};
  }
}

function lessonIdFromHash(hash: string): LessonId | null {
  const candidate = hash.replace(/^#/, "");
  return lessons.some((lesson) => lesson.id === candidate) ? candidate as LessonId : null;
}

export default function StudyGuidePage() {
  const [activeId, setActiveId] = useState<LessonId>("start");
  const [completed, setCompleted] = useState<Partial<Record<LessonId, boolean>>>({});
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const skipInitialHeadingFocus = useRef(true);
  const activeLesson = lessons.find((lesson) => lesson.id === activeId) || lessons[0];
  const activeIndex = lessons.findIndex((lesson) => lesson.id === activeId);
  const completedCount = lessons.filter((lesson) => completed[lesson.id]).length;
  const progressPercent = Math.round((completedCount / lessons.length) * 100);

  useEffect(() => {
    setCompleted(readProgress());
    setProgressLoaded(true);
  }, []);

  useEffect(() => {
    const syncFromHash = () => setActiveId(lessonIdFromHash(window.location.hash) || "start");
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, []);

  useEffect(() => {
    if (skipInitialHeadingFocus.current) {
      skipInitialHeadingFocus.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const heading = headingRef.current;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId]);

  useEffect(() => {
    if (!progressLoaded) return;
    const completedIds = lessons.filter((lesson) => completed[lesson.id]).map((lesson) => lesson.id);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(completedIds));
      setStorageNotice("");
    } catch {
      setStorageNotice("Progress is kept in memory for this visit because browser storage is unavailable.");
    }
  }, [completed, progressLoaded]);

  const setLessonCompleted = (lessonId: LessonId, value?: boolean) => {
    setCompleted((current) => ({ ...current, [lessonId]: value ?? !current[lessonId] }));
  };

  const selectLesson = (lessonId: LessonId) => {
    if (lessonId === activeId) return;
    setActiveId(lessonId);
    const url = new URL(window.location.href);
    url.hash = lessonId;
    window.history.pushState({ lesson: lessonId }, "", url);
  };

  const goToLesson = (index: number) => {
    const nextLesson = lessons[index];
    if (!nextLesson) return;
    selectLesson(nextLesson.id);
  };

  return (
    <main className="study-shell">
      <header className="study-topbar">
        <div className="study-brand-lockup"><div className="study-brand-mark"><SparkleIcon /></div><span className="study-brand-name">lumen</span><span className="study-brand-divider" /><span className="study-workspace-name">RAG study guide</span></div>
        <div className="study-topbar-actions"><div className="study-top-progress"><span className="study-status-dot" /> {completedCount}/{lessons.length} lessons complete</div><Link href="/" className="study-back-link"><ArrowIcon direction="left" /> Research workspace</Link></div>
      </header>

      <div className="study-layout">
        <aside className="study-sidebar" aria-label="Study guide lessons">
          <div className="study-sidebar-heading"><p className="eyebrow">Learning path</p><h2>RAG, from first principles.</h2><p>Short lessons for building, explaining, and improving this workspace.</p><Link href="/study-guide/reference" className="full-guide-link">Full guide · 30 interview questions <ArrowIcon direction="right" /></Link></div>
          <section className="study-progress-card" aria-label={`${progressPercent}% complete`}><div className="study-progress-heading"><span>Your progress</span><strong>{progressPercent}%</strong></div><div className="study-progress-track"><span style={{ width: `${progressPercent}%` }} /></div><p>{completedCount === lessons.length ? "You completed the path." : `${lessons.length - completedCount} ${lessons.length - completedCount === 1 ? "lesson" : "lessons"} left in the path.`}</p></section>
          {storageNotice && <p className="study-storage-notice" role="status">{storageNotice}</p>}
          <nav className="lesson-nav">
            {lessons.map((lesson) => {
              const isActive = lesson.id === activeId;
              const isComplete = Boolean(completed[lesson.id]);
              return <div className={`lesson-nav-item ${isActive ? "lesson-nav-item-active" : ""} ${isComplete ? "lesson-nav-item-complete" : ""}`} key={lesson.id}><button type="button" className="lesson-nav-main" onClick={() => selectLesson(lesson.id)} aria-current={isActive ? "page" : undefined}><span className="lesson-nav-number">{lesson.number}</span><span className="lesson-nav-copy"><strong>{lesson.label}</strong><small>{lesson.duration} <i>·</i> {lesson.description}</small></span></button><label className="lesson-check-label"><input type="checkbox" checked={isComplete} onChange={(event) => setLessonCompleted(lesson.id, event.target.checked)} aria-label={`Mark ${lesson.label} complete`} /><span className="lesson-checkmark"><CheckIcon /></span></label></div>;
            })}
          </nav>
          <div className="study-sidebar-footer"><span className="local-only-icon">⌁</span><p><strong>{storageNotice ? "Memory only" : "Saved locally"}</strong><br />{storageNotice ? "Progress lasts this visit." : "Your checked lessons stay in this browser."}</p></div>
        </aside>

          <section className="study-main" aria-labelledby="active-lesson-title">
          <div className="study-main-header"><div className="study-breadcrumb"><span>Module {activeLesson.number}</span><i> / </i><span>{activeLesson.duration}</span><span className="study-breadcrumb-status">{completed[activeLesson.id] ? "completed" : "in progress"}</span></div><h1 id="active-lesson-title" ref={headingRef} tabIndex={-1}>{activeLesson.label}</h1><p>{activeLesson.description}</p><div className="lesson-toolbar"><button type="button" className={`complete-lesson-button ${completed[activeLesson.id] ? "complete-lesson-button-done" : ""}`} onClick={() => setLessonCompleted(activeLesson.id)} aria-pressed={Boolean(completed[activeLesson.id])}>{completed[activeLesson.id] ? <CheckIcon /> : <span className="empty-check" />} {completed[activeLesson.id] ? "Lesson completed" : "Mark lesson complete"}</button><div className="lesson-step-controls"><button type="button" onClick={() => goToLesson(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Previous lesson"><ArrowIcon direction="left" /></button><span>{activeIndex + 1} <i>/</i> {lessons.length}</span><button type="button" onClick={() => goToLesson(activeIndex + 1)} disabled={activeIndex === lessons.length - 1} aria-label="Next lesson"><ArrowIcon direction="right" /></button></div></div></div>
          <div className="lesson-content"><LessonContent lessonId={activeLesson.id} /></div>
          <div className="lesson-bottom-nav"><button type="button" onClick={() => goToLesson(activeIndex - 1)} disabled={activeIndex === 0}><ArrowIcon direction="left" /><span>Previous<br /><strong>{lessons[activeIndex - 1]?.label || "Start"}</strong></span></button><button type="button" onClick={() => goToLesson(activeIndex + 1)} disabled={activeIndex === lessons.length - 1}><span>Next lesson<br /><strong>{lessons[activeIndex + 1]?.label || "Complete"}</strong></span><ArrowIcon direction="right" /></button></div>
        </section>

        <aside className="study-snapshot" aria-label="Project snapshot">
          <div className="snapshot-heading"><p className="eyebrow">Project snapshot</p><span className="snapshot-static">static concept map</span></div>
          <div className="snapshot-identity"><div className="snapshot-avatar"><SparkleIcon /></div><div><h2>RAG Research Workspace</h2><p>local-first document QA</p></div></div>
          <div className="snapshot-metrics"><div><strong>7</strong><span>formats</span></div><div><strong>2</strong><span>retrieval channels</span></div><div><strong>1</strong><span>grounding boundary</span></div></div>
          <section className="snapshot-section"><div className="snapshot-section-title"><span className="snapshot-section-dot snapshot-section-dot-now" /><h3>Implemented now</h3></div><ul>{implementedNow.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="snapshot-section snapshot-section-next"><div className="snapshot-section-title"><span className="snapshot-section-dot snapshot-section-dot-next" /><h3>Planned next</h3></div><ul>{plannedNext.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <section className="snapshot-cue"><p className="card-kicker">Interview cue</p><p>{activeId === "retrieval" ? "Scores rank chunks. They do not certify that an answer is correct." : activeId === "generation" ? "Validate citations, then show the evidence path." : activeId === "production" ? "Measure the baseline before adding complexity." : "Keep the implemented path and the proposed path distinct."}</p></section>
          <div className="snapshot-footnote"><span>⌘</span><p>Everything in this guide is a local, interactive visual. It makes no API calls.</p></div>
        </aside>
      </div>
    </main>
  );
}
