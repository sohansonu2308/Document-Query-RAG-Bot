"""Focused tests for ingestion and retrieval behavior."""

from io import BytesIO

import pytest

from app.services.extraction import chunk_text, extract_text
from app.services.retrieval import RetrievalChunk, RetrievalHit, keyword_search, merge_hybrid_results


def test_extract_csv_and_chunk_text():
    text = extract_text("facts.csv", b"Topic,Value\nLaunch,October\n")

    assert "Topic | Value" in text
    assert "Launch | October" in text
    assert chunk_text(text, chunk_size=20, overlap=5)


def test_extract_pdf_includes_page_citation():
    fitz = pytest.importorskip("fitz")
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Quarterly launch plan")

    text = extract_text("plan.pdf", document.tobytes())

    assert "[PDF page 1]" in text
    assert "Quarterly launch plan" in text


def test_extract_docx_includes_section_and_table_citations():
    docx = pytest.importorskip("docx")
    document = docx.Document()
    document.add_heading("Launch", level=1)
    document.add_paragraph("The launch is in October.")
    table = document.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Owner"
    table.cell(0, 1).text = "Ava"
    output = BytesIO()
    document.save(output)

    text = extract_text("plan.docx", output.getvalue())

    assert "[DOCX section 1, paragraph 1]" in text
    assert "[DOCX section 1, paragraph 2]" in text
    assert "table 1 row 1" in text
    assert "Owner | Ava" in text


def test_extract_xlsx_includes_sheet_and_row_citations():
    openpyxl = pytest.importorskip("openpyxl")
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Roadmap"
    sheet.append(["Milestone", "Date"])
    sheet.append(["Launch", "October"])
    output = BytesIO()
    workbook.save(output)

    text = extract_text("roadmap.xlsx", output.getvalue())

    assert "[XLSX sheet Roadmap, row 1]" in text
    assert "[XLSX sheet Roadmap, row 2]" in text
    assert "Launch | October" in text


def test_extract_pptx_includes_slide_citation():
    pptx = pytest.importorskip("pptx")
    presentation = pptx.Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = "Launch status"
    output = BytesIO()
    presentation.save(output)

    text = extract_text("status.pptx", output.getvalue())

    assert "[PPTX slide 1]" in text
    assert "Launch status" in text


def test_binary_document_empty_and_invalid_inputs_are_clear_errors():
    with pytest.raises(ValueError, match="empty or contains no extractable text"):
        extract_text("empty.txt", b" \n")
    with pytest.raises(ValueError, match="malformed"):
        extract_text("broken.pdf", b"not a pdf")


def test_keyword_search_is_ranked_and_deterministic():
    chunks = [
        RetrievalChunk("2", "doc-2", "second.md", 0, "The launch checklist is complete."),
        RetrievalChunk("1", "doc-1", "first.md", 0, "The launch date is October."),
        RetrievalChunk("3", "doc-1", "first.md", 1, "Unrelated background information."),
    ]

    hits = keyword_search("What is the launch date?", chunks, top_k=2)

    assert [hit.chunk.chunk_id for hit in hits] == ["1", "2"]
    assert hits[0].score >= hits[1].score


def test_hybrid_score_merge_is_weighted_and_keeps_semantic_only_matches():
    chunks = [
        RetrievalChunk("keyword", "doc", "notes.md", 0, "exact launch details"),
        RetrievalChunk("semantic", "doc", "notes.md", 1, "release information"),
    ]
    keyword_hits = [RetrievalHit(chunks[0], score=4, keyword_score=4)]
    vector_hits = [
        RetrievalHit(chunks[0], score=0.6, vector_score=0.6),
        RetrievalHit(chunks[1], score=0.95, vector_score=0.95),
    ]

    merged = merge_hybrid_results(
        keyword_hits,
        vector_hits,
        top_k=2,
        keyword_weight=0.2,
        vector_weight=0.8,
    )

    assert [hit.chunk.chunk_id for hit in merged] == ["semantic", "keyword"]
    assert merged[0].keyword_score == 0
    assert merged[0].vector_score == 0.95
    assert merged[1].keyword_score == 4
