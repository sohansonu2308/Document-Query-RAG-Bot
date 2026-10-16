"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";

const API_BASE_URL = "http://localhost:8000";
const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".csv"];
const SUPPORTED_FORMATS = "PDF, DOCX, XLSX, PPTX, TXT, MD, and CSV";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const FILE_ACCEPT = [
  ...SUPPORTED_EXTENSIONS,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
].join(",");

type ApiState = "checking" | "ready" | "unavailable";
type UploadState = "idle" | "uploading" | "success" | "error";
type RemoveFeedback = {
  type: "success" | "error";
  message: string;
};

type DocumentSummary = {
  id: string;
  name: string;
  original_filename: string;
  content_type: string | null;
  size_bytes: number;
  chunk_count: number;
  status: "processing" | "ready" | "failed";
  error: string | null;
  created_at: string;
};

type ChatSource = {
  document_id: string;
  label: string;
  chunk_id: string;
  chunk_index: number;
  snippet: string;
  score: number;
  keyword_score?: number | null;
  vector_score?: number | null;
};

type RetrievalStrategy = "hybrid" | "keyword" | "vector";
type AnswerMode = "llm" | "deterministic";

type ChatResponse = {
  answer: string;
  sources: ChatSource[];
  status: "ok" | "no_match";
  strategy: RetrievalStrategy;
  embedding_model: string | null;
  answer_mode: AnswerMode;
  answer_provider: string | null;
  answer_model: string | null;
};

type DocumentListResponse = {
  documents: DocumentSummary[];
  total: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function responseMessage(response: Response, fallback: string) {
  const payload: unknown = await response.json().catch(() => null);
  if (isRecord(payload)) {
    if (typeof payload.detail === "string") return payload.detail;
    if (typeof payload.message === "string") return payload.message;
  }
  return fallback;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function fileTone(filename: string) {
  const extension = fileExtension(filename);
  if ([".pdf", ".pptx", ".csv"].includes(extension)) return "orange";
  if ([".xlsx", ".md"].includes(extension)) return "green";
  if ([".docx", ".txt"].includes(extension)) return "purple";
  return "neutral";
}

function fileType(filename: string) {
  const extension = fileExtension(filename);
  return SUPPORTED_EXTENSIONS.includes(extension) ? extension.slice(1).toUpperCase() : "FILE";
}

function normalizeRetrievalStrategy(strategy: unknown): RetrievalStrategy {
  if (strategy === "hybrid" || strategy === "vector" || strategy === "keyword") return strategy;
  return "keyword";
}

function normalizeAnswerMode(mode: unknown): AnswerMode {
  return mode === "llm" ? "llm" : "deterministic";
}

function answerModeLabel(mode: AnswerMode) {
  return mode === "llm" ? "GPT grounded" : "Deterministic fallback";
}

function answerModeDescription(mode: AnswerMode) {
  return mode === "llm"
    ? "A configured GPT provider composed this answer from the retrieved evidence."
    : "This answer was assembled deterministically from the retrieved evidence.";
}

function retrievalStrategyLabel(strategy: RetrievalStrategy) {
  if (strategy === "hybrid") return "Hybrid retrieval";
  if (strategy === "vector") return "Vector retrieval";
  return "Keyword fallback";
}

function retrievalStrategyDescription(strategy: RetrievalStrategy) {
  if (strategy === "hybrid") return "Exact-term and semantic matches are combined for this answer.";
  if (strategy === "vector") return "Semantic matches from the embedding index are supporting this answer.";
  return "Embedding search is unavailable, so exact-term matching is being used instead.";
}

function formatScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return "Not available";
  return Number.isInteger(score) ? String(score) : score.toFixed(2);
}

function formatChannelScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score) || score === 0) return "Not used";
  return formatScore(score);
}

function documentMeta(document: DocumentSummary) {
  if (document.status === "processing") return "Indexing…";
  if (document.status === "failed") return document.error || "Indexing failed";
  return `${formatBytes(document.size_bytes)} · ${document.chunk_count} ${document.chunk_count === 1 ? "chunk" : "chunks"}`;
}

function SparkleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon icon-sparkle">
      <path d="m12 2 1.55 6.45L20 10l-6.45 1.55L12 18l-1.55-6.45L4 10l6.45-1.55L12 2Z" />
      <path d="m19 16 .68 2.32L22 19l-2.32.68L19 22l-.68-2.32L16 19l2.32-.68L19 16Z" />
    </svg>
  );
}

function FileIcon({ type, tone }: { type: string; tone: string }) {
  return <span className={`file-icon file-icon-${tone}`}>{type}</span>;
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M12 19V5m0 0-5.5 5.5M12 5l5.5 5.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d="M5 7h14M9 7V5h6v2m-8 0 1 13h8l1-13M10 10v7m4-7v7" />
    </svg>
  );
}

export default function Home() {
  const [sources, setSources] = useState<DocumentSummary[]>([]);
  const [apiState, setApiState] = useState<ApiState>("checking");
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceError, setSourceError] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [question, setQuestion] = useState("");
  const [askedQuestion, setAskedQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatResponse, setChatResponse] = useState<ChatResponse | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [removeFeedback, setRemoveFeedback] = useState<RemoveFeedback | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshSources = async () => {
    setSourceLoading(true);
    setSourceError("");
    try {
      const response = await fetch(`${API_BASE_URL}/documents`);
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Unable to load your sources."));
      }
      const payload = (await response.json()) as DocumentListResponse;
      setSources(Array.isArray(payload.documents) ? payload.documents : []);
      setApiState("ready");
    } catch (error) {
      setApiState("unavailable");
      setSourceError(error instanceof Error ? error.message : "The API is unavailable right now.");
    } finally {
      setSourceLoading(false);
    }
  };

  useEffect(() => {
    void refreshSources();
  }, []);

  const uploadFile = async (file: File) => {
    setUploadState("uploading");
    setUploadMessage("");
    setSourceError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_BASE_URL}/documents`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const message = await responseMessage(response, "The document could not be indexed.");
        if (response.status >= 500) setApiState("unavailable");
        throw new Error(message);
      }
      await response.json();
      setUploadState("success");
      setUploadMessage(`${file.name} is indexed and ready to search.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshSources();
    } catch (error) {
      setUploadState("error");
      setUploadMessage(error instanceof Error ? error.message : "The document could not be uploaded.");
      if (error instanceof TypeError) setApiState("unavailable");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const selectFile = (file: File | undefined) => {
    setIsDragging(false);
    setUploadMessage("");
    if (!file) return;
    if (!SUPPORTED_EXTENSIONS.includes(fileExtension(file.name))) {
      setUploadState("error");
      setUploadMessage(`Unsupported file type. Choose a ${SUPPORTED_FORMATS} file (up to 50 MB).`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadState("error");
      setUploadMessage(`${file.name} exceeds the 50 MB limit. Choose a smaller file.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    void uploadFile(file);
  };

  const requestSourceRemoval = (sourceId: string) => {
    if (removingSourceId) return;
    setRemoveFeedback(null);
    setConfirmDeleteId((currentId) => currentId === sourceId ? null : sourceId);
  };

  const removeSource = async (source: DocumentSummary) => {
    if (removingSourceId) return;

    setRemovingSourceId(source.id);
    setConfirmDeleteId(null);
    setRemoveFeedback(null);
    try {
      const response = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(source.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, `Could not remove ${source.name}.`));
      }

      if (chatResponse?.sources.some((citedSource) => citedSource.document_id === source.id)) {
        setChatResponse(null);
        setAskedQuestion("");
        setQuestion("");
        setChatError("");
      }

      setRemoveFeedback({ type: "success", message: `${source.name} was removed.` });
      await refreshSources();
    } catch (error) {
      setRemoveFeedback({
        type: "error",
        message: error instanceof Error ? error.message : `Could not remove ${source.name}.`,
      });
    } finally {
      setRemovingSourceId(null);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files?.[0]);
  };

  const handleQuestionSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setChatError("Enter a question about your sources first.");
      return;
    }

    setQuestion(trimmedQuestion);
    setAskedQuestion(trimmedQuestion);
    setChatLoading(true);
    setChatError("");
    setChatResponse(null);
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      if (!response.ok) {
        const message = await responseMessage(response, "The assistant could not answer right now.");
        if (response.status >= 500) setApiState("unavailable");
        throw new Error(message);
      }
      const payload = (await response.json()) as Partial<ChatResponse>;
      setChatResponse({
        answer: payload.answer || "I could not find an answer in the indexed sources.",
        sources: Array.isArray(payload.sources) ? payload.sources : [],
        status: payload.status === "ok" ? "ok" : "no_match",
        strategy: normalizeRetrievalStrategy(payload.strategy),
        embedding_model: typeof payload.embedding_model === "string" ? payload.embedding_model : null,
        answer_mode: normalizeAnswerMode(payload.answer_mode),
        answer_provider: typeof payload.answer_provider === "string" ? payload.answer_provider : null,
        answer_model: typeof payload.answer_model === "string" ? payload.answer_model : null,
      });
      setApiState("ready");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "The assistant could not answer right now.");
      if (error instanceof TypeError) setApiState("unavailable");
    } finally {
      setChatLoading(false);
    }
  };

  const apiStatusLabel = apiState === "checking" ? "Connecting…" : apiState === "ready" ? "API connected" : "API unavailable";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><SparkleIcon /></div>
          <span className="brand-name">lumen</span>
          <span className="brand-divider" />
          <span className="workspace-name">Research workspace</span>
        </div>
        <div className="topbar-actions">
          <Link className="study-guide-link" href="/study-guide">Study guide <span aria-hidden="true">↗</span></Link>
          <span className={`local-status local-status-${apiState}`}><span className="status-dot" /> {apiStatusLabel}</span>
          <button className="avatar" aria-label="Open account menu">JD</button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sources-panel" aria-label="Source library">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>Sources <span>{sources.length}</span></h2>
            </div>
            <button className="icon-button" aria-label="Add a source" onClick={() => fileInputRef.current?.click()}><PlusIcon /></button>
          </div>

          <label
            className={`upload-card ${isDragging ? "upload-card-dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} hidden onChange={handleFileChange} />
            <span className="upload-icon"><ArrowUpIcon /></span>
            <span className="upload-copy">
              <strong>{uploadState === "uploading" ? "Indexing document…" : "Drop files to add"}</strong>
              <span>PDF, DOCX, XLSX, PPTX, TXT, MD, CSV</span>
              <span>Up to 50 MB per file</span>
            </span>
            <span className="upload-link">Browse</span>
          </label>
          {uploadMessage && <p className={`inline-status inline-status-${uploadState}`} role="status">{uploadMessage}</p>}
          {removeFeedback && <p className={`inline-status inline-status-remove-${removeFeedback.type}`} role={removeFeedback.type === "error" ? "alert" : "status"}>{removeFeedback.message}</p>}

          <div className="source-list">
            <p className="list-label">Indexed sources</p>
            {sourceLoading ? (
              <div className="source-placeholder"><span className="spinner" /> Loading sources…</div>
            ) : sourceError ? (
              <div className="source-placeholder source-placeholder-error">
                <strong>Couldn’t reach the API</strong>
                <span>{sourceError}</span>
                <button type="button" onClick={() => void refreshSources()}>Try again</button>
              </div>
            ) : sources.length === 0 ? (
              <div className="source-placeholder"><strong>No sources yet</strong><span>Add a {SUPPORTED_FORMATS} file up to 50 MB to begin.</span></div>
            ) : (
              sources.map((source) => (
                <div className={`source-item ${removingSourceId === source.id ? "source-item-removing" : ""}`} key={source.id} aria-busy={removingSourceId === source.id}>
                  <FileIcon type={fileType(source.original_filename || source.name)} tone={fileTone(source.original_filename || source.name)} />
                  <span className="source-copy">
                    <strong title={source.name}>{source.name}</strong>
                    <span>{documentMeta(source)}</span>
                  </span>
                  {removingSourceId === source.id ? (
                    <span className="source-removing-status" role="status"><span className="spinner" /> Removing…</span>
                  ) : confirmDeleteId === source.id ? (
                    <span className="source-confirmation" role="group" aria-label={`Confirm removal of ${source.name}`}>
                      <span>Remove?</span>
                      <button className="source-confirm-button source-confirm-button-yes" type="button" onClick={() => void removeSource(source)}>Yes</button>
                      <button className="source-confirm-button" type="button" onClick={() => setConfirmDeleteId(null)}>No</button>
                    </span>
                  ) : (
                    <>
                      {source.status === "ready" ? <span className="source-check" aria-label="Indexed">✓</span> : <span className={`source-state source-state-${source.status}`}>{source.status === "processing" ? "…" : "!"}</span>}
                      <button className="source-remove" type="button" aria-label={`Remove ${source.name}`} title={`Remove ${source.name}`} onClick={() => requestSourceRemoval(source.id)}>
                        <RemoveIcon />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="storage-card">
            <div className="storage-row"><span>Local index</span><span>Ready for search</span></div>
            <div className="storage-track"><span style={{ width: sources.length ? "12%" : "2.5%" }} /></div>
            <p>Everything stays on this device.</p>
          </div>
        </aside>

        <section className="chat-panel" aria-label="Chat with your sources">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Ask your sources</p>
              <h1>Research assistant</h1>
            </div>
            <button className="quiet-button" type="button" onClick={() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()}><span className="keyboard-hint">⌘ K</span> Search</button>
          </div>

          <div className={`conversation ${chatResponse || chatLoading || chatError ? "conversation-active" : ""}`}>
            {chatResponse || chatLoading || chatError ? (
              <div className="conversation-result">
                {askedQuestion && <div className="question-bubble">{askedQuestion}</div>}
                {chatLoading ? (
                  <div className="answer-card answer-loading" aria-live="polite"><span className="spinner" /> Searching your indexed sources…</div>
                ) : chatError ? (
                  <div className="answer-card answer-card-error" role="alert"><strong>Something went wrong</strong><span>{chatError}</span></div>
                 ) : chatResponse ? (
                   <article className="answer-card">
                     <div className="answer-header">
                       <div className="answer-label"><span className="welcome-icon mini"><SparkleIcon /></span><span>Research answer</span></div>
                       <span className={`answer-mode answer-mode-${chatResponse.answer_mode}`} role="status">
                         <span className="answer-mode-dot" /> {answerModeLabel(chatResponse.answer_mode)}
                       </span>
                     </div>
                     <div className="answer-context">
                       <p>{answerModeDescription(chatResponse.answer_mode)}</p>
                       {chatResponse.answer_mode === "llm" && (chatResponse.answer_provider || chatResponse.answer_model) ? (
                         <span className="answer-provider" title={[chatResponse.answer_provider, chatResponse.answer_model].filter(Boolean).join(" · ")}>
                           {[chatResponse.answer_provider, chatResponse.answer_model].filter(Boolean).join(" · ")}
                         </span>
                       ) : null}
                     </div>
                     {chatResponse.answer_mode === "deterministic" && !chatResponse.answer_provider ? (
                       <div className="fallback-notice" role="note">
                         <span className="fallback-notice-icon">i</span>
                         <span>No GPT provider is configured, so this response used the deterministic fallback.</span>
                       </div>
                     ) : null}
                     <div className={`retrieval-meta retrieval-meta-${chatResponse.strategy}`}>
                       <div className="retrieval-meta-heading">
                         <span className="retrieval-strategy"><span className="retrieval-dot" /> {retrievalStrategyLabel(chatResponse.strategy)}</span>
                         {chatResponse.embedding_model ? (
                           <span className="embedding-model" title={chatResponse.embedding_model}>Embedding · {chatResponse.embedding_model}</span>
                         ) : (
                           <span className="embedding-model embedding-model-unavailable">Embedding unavailable</span>
                         )}
                       </div>
                       <p>{retrievalStrategyDescription(chatResponse.strategy)}</p>
                     </div>
                     <p>{chatResponse.answer}</p>
                     {chatResponse.status === "no_match" && <span className="no-match-note">No matching evidence was found in your indexed sources.</span>}
                   </article>
                ) : null}
              </div>
            ) : (
              <>
                <div className="welcome-block">
                  <div className="welcome-icon"><SparkleIcon /></div>
                  <p className="eyebrow">Ready when you are</p>
                  <h2>What would you like to find?</h2>
                  <p>Ask a question about your sources, and Lumen will surface an answer with the supporting evidence.</p>
                </div>
                <div className="suggestion-grid">
                  {["Summarize the key themes", "Compare the research findings", "Find gaps in the evidence", "Draft a concise brief"].map((suggestion, index) => (
                    <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); setChatError(""); }}><span>{["✦", "⌁", "◌", "↗"][index]}</span> {suggestion}</button>
                  ))}
                </div>
              </>
            )}
          </div>

          <form className="composer" onSubmit={handleQuestionSubmit}>
            <div className="composer-box">
              <textarea aria-label="Ask a question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask anything about your sources..." rows={2} disabled={chatLoading} />
              <div className="composer-footer">
                <span className="composer-note"><span className="tiny-dot" /> Answers use your local index</span>
                <button className="send-button" type="submit" aria-label="Send question" disabled={chatLoading || !question.trim()}><ArrowUpIcon /></button>
              </div>
            </div>
            <p className="disclaimer">Lumen can make mistakes. Check the cited sources for important decisions.</p>
          </form>
        </section>

        <aside className="evidence-panel" aria-label="Evidence panel">
          <div className="panel-heading evidence-heading">
            <div>
              <p className="eyebrow">Traceable answers</p>
              <h2>Evidence <span>{chatResponse?.sources.length || 0}</span></h2>
            </div>
            <button className="icon-button" type="button" aria-label="Focus question" onClick={() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus()}><SearchIcon /></button>
          </div>
          {chatLoading ? (
            <div className="evidence-loading"><span className="spinner" /> Gathering citations…</div>
          ) : chatResponse?.sources.length ? (
            <div className="evidence-list">
               {chatResponse.sources.map((source, index) => (
                 <article className="evidence-card" key={source.chunk_id}>
                   <div className="evidence-card-heading"><span className="citation-number">{index + 1}</span><strong>{source.label}</strong></div>
                   <p>{source.snippet}</p>
                   <details className="evidence-score-details">
                     <summary>
                       <span>Combined score</span>
                       <strong>{formatScore(source.score)}</strong>
                       <span className="score-details-label">Breakdown</span>
                     </summary>
                     <div className="evidence-score-breakdown">
                       <div><span>Keyword contribution</span><strong>{formatChannelScore(source.keyword_score)}</strong></div>
                       <div><span>Vector contribution</span><strong>{formatChannelScore(source.vector_score)}</strong></div>
                     </div>
                   </details>
                 </article>
               ))}
            </div>
          ) : chatResponse ? (
            <div className="evidence-empty evidence-empty-result">
              <div className="evidence-illustration"><span /><span /><span /></div>
              <h3>No matching passages</h3>
              <p>Try a more specific question or add another source.</p>
            </div>
          ) : (
            <div className="evidence-empty">
              <div className="evidence-illustration"><span /><span /><span /></div>
              <h3>Evidence will appear here</h3>
              <p>Ask a question to see the passages and sources behind each answer.</p>
            </div>
          )}
          <div className="evidence-tip">
            <span>i</span>
            <p>Citations stay linked to the exact text they came from.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
