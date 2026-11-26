"""PDF and image loading, page store behaviour."""

from __future__ import annotations

import time

import pytest

from app import config
from app.pages import (
    PageStore,
    UnsupportedDocumentError,
    is_pdf,
    load_pdf_pages,
    pages_from_upload,
)
from synthetic import encode_png, render_drawing, scanned_pdf


def test_vector_pdf_is_recognised_as_a_text_document(vector_pdf):
    pages = load_pdf_pages(vector_pdf, 0)
    assert len(pages) == 1
    page = pages[0]
    assert page.source == "pdf_vector"
    assert page.dpi == config.PDF_PREVIEW_DPI
    assert page.perspective_corrected is False
    assert page.width > 1000
    assert page.vector_lines


def test_scanned_pdf_is_rasterized_at_300_dpi(scan_pdf):
    pages = load_pdf_pages(scan_pdf, 0)
    page = pages[0]
    assert page.source == "pdf_raster"
    assert page.dpi == config.PDF_RASTER_DPI
    assert max(page.width, page.height) <= config.MAX_WORKING_SIDE
    assert page.vector_lines == []


def test_multipage_pdf_keeps_sheet_order(spec_pdf):
    pages = load_pdf_pages(spec_pdf, 0)
    assert len(pages) == 2
    assert [page.page_index for page in pages] == [0, 1]
    assert pages[0].source == "pdf_vector"
    second_texts = " ".join(line.text for line in pages[1].vector_lines)
    assert "Спецификация" in second_texts


def test_start_index_is_respected(vector_pdf):
    pages = load_pdf_pages(vector_pdf, 3)
    assert pages[0].page_index == 3


def test_image_upload_is_accepted(drawing):
    pages = pages_from_upload(encode_png(drawing), "photo.png", 0)
    assert len(pages) == 1
    assert pages[0].source == "image"
    assert pages[0].layout.frame is not None


def test_garbage_bytes_are_rejected():
    with pytest.raises(UnsupportedDocumentError):
        pages_from_upload(b"not an image at all", "notes.txt", 0)


def test_is_pdf_detects_by_magic_and_name():
    assert is_pdf(b"%PDF-1.7 whatever", "file.bin") is True
    assert is_pdf(b"\x89PNG\r\n", "sheet.pdf") is True
    assert is_pdf(b"\x89PNG\r\n", "sheet.png") is False


def test_page_store_roundtrip(vector_pdf):
    page = load_pdf_pages(vector_pdf, 0)[0]
    store = PageStore(ttl=60, max_items=2)
    store.put(page)
    assert store.get(page.page_id) is page
    assert store.get("pg-missing") is None


def test_page_store_evicts_old_pages(vector_pdf):
    first = load_pdf_pages(vector_pdf, 0)[0]
    second = load_pdf_pages(vector_pdf, 1)[0]
    third = load_pdf_pages(vector_pdf, 2)[0]

    store = PageStore(ttl=60, max_items=2)
    for page in (first, second, third):
        store.put(page)

    assert store.get(first.page_id) is None
    assert store.get(third.page_id) is third


def test_page_store_expires_pages(vector_pdf):
    page = load_pdf_pages(vector_pdf, 0)[0]
    store = PageStore(ttl=0.02, max_items=4)
    store.put(page)
    time.sleep(0.05)
    assert store.get(page.page_id) is None


def test_scanned_and_vector_sources_differ(vector_pdf):
    vector = load_pdf_pages(vector_pdf, 0)[0]
    raster = load_pdf_pages(scanned_pdf(120), 0)[0]
    assert vector.source != raster.source
    assert set(vector.warnings) != {"stamp_not_found"}
