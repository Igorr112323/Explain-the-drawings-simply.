"""Line extraction: vector spans, OCR orientation mapping, merging and stamps."""

from __future__ import annotations

import io

import pymupdf
import pytest

from app.extractor import (
    TextLine,
    back_map_box,
    build_candidates,
    dedupe_lines,
    extract_vector_lines,
    lines_in_rect,
    merge_stacked_lines,
    parse_title_block,
)
from app.layout import Box, detect_layout
from app.pages import load_pdf_pages
from synthetic import FONT_REGULAR, build_vector_pdf


def test_back_map_box_for_rotated_sheets():
    # Sheet 200×100, box (10, 20, 30, 40) found in the 90° clockwise copy.
    mapped = back_map_box((10, 20, 30, 40), 90, 200, 100)
    assert (mapped.x, mapped.y, mapped.w, mapped.h) == (20, 59, 40, 30)

    mapped = back_map_box((10, 20, 30, 40), 270, 200, 100)
    assert (mapped.x, mapped.y, mapped.w, mapped.h) == (139, 10, 40, 30)

    mirrored = back_map_box((10, 20, 30, 40), 180, 200, 100)
    assert (mirrored.x, mirrored.y, mirrored.w, mirrored.h) == (160, 40, 30, 40)

    assert back_map_box((1, 2, 3, 4), 0, 200, 100) == Box(1, 2, 3, 4)


def test_vector_pdf_lines_have_exact_percent_coordinates(vector_pdf):
    page = load_pdf_pages(vector_pdf, 0)[0]
    assert page.source == "pdf_vector"
    texts = {line.text: line for line in page.vector_lines}

    assert "Ø20 H7" in texts
    diameter = texts["Ø20 H7"]
    assert diameter.confidence == 0.99
    assert diameter.rotation == 0

    # Inserted at 60 mm / 80 mm on a 297×210 mm sheet.
    assert diameter.box.x / page.width * 100 == pytest.approx(60 / 297 * 100, abs=1.2)
    assert diameter.box.y / page.height * 100 == pytest.approx(80 / 210 * 100, abs=2.6)


def test_rotated_vector_text_keeps_its_angle():
    document = pymupdf.open()
    page = document.new_page(width=400, height=300)
    page.insert_text((300, 250), "Ø12 H7 глуб. 20", fontsize=12, fontname="dejavu", fontfile=str(FONT_REGULAR), rotate=90)
    buffer = io.BytesIO()
    document.save(buffer)
    document.close()

    loaded = load_pdf_pages(buffer.getvalue(), 0)[0]
    rotated = [line for line in loaded.vector_lines if line.text.startswith("Ø12")]
    assert rotated, [line.text for line in loaded.vector_lines]
    assert rotated[0].rotation == 90


def test_merge_stacked_callout():
    lines = [
        TextLine("4 отв.", Box(100, 100, 80, 22), 0.9),
        TextLine("М8-7H", Box(104, 126, 96, 22), 0.85),
        TextLine("Ra 1,6", Box(400, 300, 70, 20), 0.9),
    ]
    merged = merge_stacked_lines(lines)
    texts = [line.text for line in merged]
    assert "4 отв. М8-7H" in texts
    assert "Ra 1,6" in texts
    assert len(merged) == 2


def test_merge_does_not_join_unrelated_lines():
    lines = [
        TextLine("Масштаб", Box(100, 100, 80, 22), 0.9),
        TextLine("1:2", Box(104, 126, 40, 22), 0.9),
        TextLine("Лист 1", Box(104, 152, 60, 22), 0.9),
    ]
    assert len(merge_stacked_lines(lines)) == 3


def test_dedupe_keeps_the_upright_reading():
    upright = TextLine("12", Box(50, 50, 30, 20), 0.8, rotation=0)
    vertical = TextLine("12", Box(52, 51, 28, 20), 0.95, rotation=90)
    kept = dedupe_lines([vertical, upright])
    assert len(kept) == 1
    assert kept[0].rotation == 0


def test_candidates_keep_confidence_and_ambiguity_for_ocr():
    lines = [
        TextLine("M8-7H", Box(100, 100, 120, 26), 0.97, source="ocr"),
        TextLine("12", Box(200, 300, 40, 26), 0.97, source="ocr"),
    ]
    layout = detect_layout(load_pdf_pages(build_vector_pdf(), 0)[0].image)
    candidates = build_candidates(lines, layout, 0)

    thread = next(candidate for candidate in candidates if "8" in candidate.normalizedText)
    assert thread.normalizedText == "М8-7H"
    assert thread.confidence < 0.95  # «8» can be read as «6»

    dimension = next(candidate for candidate in candidates if candidate.normalizedText == "12")
    assert "18" in dimension.ambiguousOptions
    assert dimension.confidence < 0.95


def test_vector_candidates_are_not_marked_ambiguous():
    pdf_page = load_pdf_pages(build_vector_pdf(), 0)[0]
    candidates = build_candidates(pdf_page.vector_lines, pdf_page.layout, 0)
    for candidate in candidates:
        assert candidate.ambiguousOptions == []
        assert candidate.confidence >= 0.95
        assert candidate.source == "pdf"


def test_title_block_metadata_from_vector_pdf(vector_pdf):
    page = load_pdf_pages(vector_pdf, 0)[0]
    block = parse_title_block(page.vector_lines, page.layout, 0)
    assert block is not None
    assert block.code == "КС-04.100.000 СБ"
    assert block.name == "Кронштейн"
    assert block.material == "09Г2С"
    assert block.scale == "1:2"
    assert block.sheet == "1"
    assert block.confidence >= 0.9


def test_title_block_is_absent_without_a_stamp():
    blank = detect_layout(__import__("numpy").full((1240, 1754, 3), 255, dtype="uint8"))
    assert parse_title_block([], blank, 0) is None


def test_lines_in_rect_selects_the_roi():
    lines = [
        TextLine("Ø20 H7", Box(100, 100, 120, 30), 0.99),
        TextLine("Ra 1,6", Box(600, 400, 80, 30), 0.99),
    ]
    selected = lines_in_rect(lines, Box(90, 90, 200, 100))
    assert [line.text for line in selected] == ["Ø20 H7"]
