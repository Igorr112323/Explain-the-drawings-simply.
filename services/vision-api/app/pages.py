"""Upload decoding: PDF (vector or scanned), photos and scans → prepared pages + a page store.

Pages are kept in memory for `PAGE_TTL_SECONDS` so the «Рентген» screen can re-read a user-selected
rectangle without uploading the sheet again.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

import cv2
import pymupdf as fitz  # PyMuPDF
import numpy as np

from . import config
from .extractor import TextLine, extract_vector_lines
from .layout import Layout, detect_layout
from .preprocessing import decode_image_bytes, limit_size, process_image, upscale_for_ocr
from .schemas import QualityReport

PageSource = Literal["pdf_vector", "pdf_raster", "image"]


class UnsupportedDocumentError(ValueError):
    """PDF cannot be opened or the file is neither an image nor a PDF."""


@dataclass
class PreparedPage:
    page_id: str
    page_index: int
    source: PageSource
    image: np.ndarray
    layout: Layout
    vector_lines: list[TextLine]
    dpi: int
    perspective_corrected: bool
    quality_before: QualityReport
    quality_after: QualityReport
    warnings: list[str] = field(default_factory=list)
    upscale: float = 1.0

    @property
    def width(self) -> int:
        return self.image.shape[1]

    @property
    def height(self) -> int:
        return self.image.shape[0]


def new_page_id() -> str:
    return f"pg-{uuid.uuid4().hex[:12]}"


def _render_pdf_page(page: fitz.Page, dpi: int) -> np.ndarray:
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
    buffer = np.frombuffer(pixmap.samples, dtype=np.uint8)
    image = buffer.reshape(pixmap.height, pixmap.width, pixmap.n)
    if pixmap.n == 4:
        image = cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)
    else:
        image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    return np.ascontiguousarray(image)


def load_pdf_pages(data: bytes, start_index: int) -> list[PreparedPage]:
    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as error:  # corrupt or encrypted PDF
        raise UnsupportedDocumentError(f"PDF не открывается: {type(error).__name__}") from error

    pages: list[PreparedPage] = []
    try:
        page_count = min(document.page_count, config.MAX_PAGES)
        for page_number in range(page_count):
            pdf_page = document.load_page(page_number)
            preview = _render_pdf_page(pdf_page, config.PDF_PREVIEW_DPI)
            vector_scale = config.PDF_PREVIEW_DPI / 72.0
            vector = extract_vector_lines(pdf_page, vector_scale)
            vector_chars = sum(len(line.text) for line in vector)

            page_index = start_index + page_number
            if vector_chars >= config.VECTOR_TEXT_MIN_CHARS:
                image = preview
                layout = detect_layout(image)
                pages.append(
                    PreparedPage(
                        page_id=new_page_id(),
                        page_index=page_index,
                        source="pdf_vector",
                        image=image,
                        layout=layout,
                        vector_lines=vector,
                        dpi=config.PDF_PREVIEW_DPI,
                        perspective_corrected=False,
                        quality_before=_assess(image),
                        quality_after=_assess(image),
                        warnings=list(layout.warnings),
                    )
                )
            else:
                raster = _render_pdf_page(pdf_page, config.PDF_RASTER_DPI)
                processed = process_image(raster)
                layout = detect_layout(processed.cleaned)
                pages.append(
                    PreparedPage(
                        page_id=new_page_id(),
                        page_index=page_index,
                        source="pdf_raster",
                        image=processed.cleaned,
                        layout=layout,
                        vector_lines=[],
                        dpi=config.PDF_RASTER_DPI,
                        perspective_corrected=processed.perspective_corrected,
                        quality_before=processed.quality_before,
                        quality_after=processed.quality_after,
                        warnings=list(dict.fromkeys([*processed.warnings, *layout.warnings])),
                    )
                )
    finally:
        document.close()

    return pages


def _assess(image: np.ndarray) -> QualityReport:
    from .quality import assess

    return assess(image)


def load_image_page(data: bytes, start_index: int) -> PreparedPage:
    raw = decode_image_bytes(data)
    processed = process_image(raw)
    layout = detect_layout(processed.cleaned)
    return PreparedPage(
        page_id=new_page_id(),
        page_index=start_index,
        source="image",
        image=processed.cleaned,
        layout=layout,
        vector_lines=[],
        dpi=max(72, int(round(processed.cleaned.shape[1] / 8.27))),  # A4 width in mm → approx dpi
        perspective_corrected=processed.perspective_corrected,
        quality_before=processed.quality_before,
        quality_after=processed.quality_after,
        warnings=list(dict.fromkeys([*processed.warnings, *layout.warnings])),
    )


def is_pdf(data: bytes, filename: str) -> bool:
    if data[:4] == b"%PDF":
        return True
    return filename.lower().endswith(".pdf")


def load_document(data: bytes, filename: str, start_index: int) -> list[PreparedPage]:
    if not data:
        raise UnsupportedDocumentError("Пустой файл: выберите лист ещё раз")

    if is_pdf(data, filename):
        return load_pdf_pages(data, start_index)

    try:
        return [load_image_page(data, start_index)]
    except ValueError as error:
        raise UnsupportedDocumentError(str(error)) from error


def pages_from_upload(data: bytes, filename: str, start_index: int) -> list[PreparedPage]:
    pages = load_document(data, filename, start_index)
    kept: list[PreparedPage] = []
    for page in pages[: config.MAX_PAGES]:
        page.image = limit_size(page.image)
        # Мелкий лист OCR читает плохо: увеличиваем и переводим геометрию в новые пиксели.
        # Векторный PDF не трогаем — у него есть текстовый слой с точными координатами.
        if page.source != "pdf_vector":
            enlarged, factor = upscale_for_ocr(page.image)
            if factor > 1.0:
                page.image = enlarged
                page.layout = page.layout.scaled(factor)
                page.dpi = max(1, int(round(page.dpi * factor)))
                page.upscale = factor
                page.warnings = list(dict.fromkeys([*page.warnings, "small_sheet_upscaled"]))
        kept.append(page)
    return kept


def page_bytes(page: PreparedPage) -> int:
    """Сколько памяти занимает страница: изображение + координаты распознанного текста."""
    image_bytes = int(getattr(page.image, "nbytes", 0)) if page.image is not None else 0
    vector_bytes = sum(64 + len(line.text) for line in page.vector_lines)
    return image_bytes + vector_bytes


class PageStore:
    """In-memory page cache for ROI re-recognition. Thread-safe, TTL + memory bounded.

    Кэш нужен только для того, чтобы «Рентген» мог перечитать выделенный прямоугольник без
    повторной загрузки листа. Держать десятки полноразмерных сканов нельзя: 1 000-кейсовый
    прогон показал, что прежний лимит «32 страницы / 30 минут» упирается в OOM и убивает сервис.
    Поэтому бюджет считается в байтах, а не в штуках.
    """

    def __init__(
        self,
        ttl: float = config.PAGE_TTL_SECONDS,
        max_items: int = config.MAX_STORED_PAGES,
        max_bytes: int = config.MAX_STORED_BYTES,
    ) -> None:
        self._items: dict[str, tuple[float, PreparedPage]] = {}
        self._lock = threading.Lock()
        self._ttl = ttl
        self._max_items = max_items
        self._max_bytes = max_bytes

    def put(self, page: PreparedPage) -> None:
        with self._lock:
            self._evict()
            self._items[page.page_id] = (time.monotonic(), page)
            self._trim()

    def _trim(self) -> None:
        while self._items and (
            len(self._items) > self._max_items or self.total_bytes() > self._max_bytes
        ):
            oldest = min(self._items.items(), key=lambda item: item[1][0])[0]
            self._items.pop(oldest, None)

    def total_bytes(self) -> int:
        return sum(page_bytes(page) for _, page in self._items.values())

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"items": len(self._items), "bytes": self.total_bytes(), "maxBytes": self._max_bytes}

    def get(self, page_id: str) -> PreparedPage | None:
        with self._lock:
            self._evict()
            entry = self._items.get(page_id)
            return entry[1] if entry else None

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def _evict(self) -> None:
        now = time.monotonic()
        expired = [key for key, (stamp, _) in self._items.items() if now - stamp > self._ttl]
        for key in expired:
            self._items.pop(key, None)
