"use client";

import { useEffect, useId, useState } from "react";

type MermaidDiagramProps = {
  chart: string;
  label: string;
};

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.65;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export default function MermaidDiagram({ chart, label }: MermaidDiagramProps) {
  const rawId = useId();
  const renderId = `study-mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const captionId = `${renderId}-caption`;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError(false);

    void import("mermaid")
      .then(({ default: mermaid }) => {
        if (cancelled) return null;
        mermaid.initialize({
          startOnLoad: false,
          // These charts are fixed, trusted source strings from the study UI.
          // Strict mode keeps Mermaid output from treating labels as HTML/scripts.
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#f0eeff",
            primaryTextColor: "#242329",
            primaryBorderColor: "#aaa0e7",
            lineColor: "#8a82b6",
            secondaryColor: "#f8f6f1",
            tertiaryColor: "#ffffff",
            fontFamily: "Avenir Next, Segoe UI, sans-serif",
          },
        });
        return mermaid.render(renderId, chart);
      })
      .then((result) => {
        if (!cancelled && result && typeof result.svg === "string") setSvg(result.svg);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  const zoomOut = () => setZoom((current) => clampZoom(current - ZOOM_STEP));
  const zoomIn = () => setZoom((current) => clampZoom(current + ZOOM_STEP));

  return (
    <figure className="mermaid-card" aria-labelledby={captionId}>
      <figcaption id={captionId}>
        <span>{label}</span>
        <span className="diagram-badge">client-rendered</span>
      </figcaption>
      <div className="mermaid-toolbar" aria-label="Diagram controls">
        <span className="mermaid-zoom-label">Zoom {Math.round(zoom * 100)}%</span>
        <div className="mermaid-zoom-controls">
          <button type="button" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out diagram">−</button>
          <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset diagram zoom">Reset</button>
          <button type="button" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in diagram">+</button>
        </div>
      </div>
      <div className="mermaid-stage" role="img" aria-label={label}>
        {svg ? (
          <div className="mermaid-zoom-viewport">
            <div className="mermaid-zoom-content" style={{ transform: `scale(${zoom})`, marginBottom: `${Math.max(0, (zoom - 1) * 180)}px` }} dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        ) : error ? (
          <div className="diagram-fallback">The diagram could not render in this browser.</div>
        ) : (
          <div className="diagram-loading"><span className="study-spinner" /> Drawing the flow…</div>
        )}
      </div>
      <details className="mermaid-source-details">
        <summary>Accessible text / diagram source</summary>
        <p>{label}. This is a fixed trusted study diagram; the source below describes the same flow for text-only reading.</p>
        <pre>{chart}</pre>
      </details>
    </figure>
  );
}
