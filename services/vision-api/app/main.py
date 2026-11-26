"""HTTP API: распознавание листов чертежа и ROI для правки обозначений.

Сервис отдаёт только геометрию и текст с честной уверенностью. Превращение обозначений в
инструкцию и сам PDF делает TypeScript (`@ikguide/builder` + `@ikguide/pdf-exporter`), поэтому
Python здесь ничего не знает ни про вёрстку, ни про файлы на диске.
"""

from __future__ import annotations

import os
import threading
import uuid
from typing import Sequence

import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from . import config
from .extractor import (
    TextLine,
    build_candidates,
    dedupe_lines,
    lines_in_rect,
    merge_stacked_lines,
    ocr_lines,
    ocr_region,
    parse_title_block,
)
from .layout import Box
from .ocr import NoopOcrEngine, OcrEngine, create_ocr_engine
from .pages import (
    PageStore,
    PreparedPage,
    UnsupportedDocumentError,
    pages_from_upload,
)
from .preprocessing import encode_data_url
from .quality import describe
from .schemas import (
    Candidate,
    EngineInfo,
    HealthResponse,
    LegacyAnnotation,
    LegacyPage,
    PagePayload,
    RecognizeResponse,
    RoiRequest,
    RoiResponse,
    TitleBlock,
    Zone,
)


class EngineState:
    """Lazy, thread-safe OCR engine holder so the service boots instantly."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._engine: OcrEngine | None = None
        self._attempted: list[str] = []

    def engine(self) -> OcrEngine:
        with self._lock:
            if self._engine is None:
                preferred = os.environ.get("IKGUIDE_OCR_ENGINE", "auto").strip() or "auto"
                self._engine, self._attempted, _warnings = create_ocr_engine(preferred)
            return self._engine

    @property
    def attempted(self) -> list[str]:
        self.engine()
        return self._attempted

    def available(self) -> bool:
        return not isinstance(self.engine(), NoopOcrEngine)


engine_state = EngineState()
page_store = PageStore()

app = FastAPI(
    title="IKGuide Vision API",
    version=config.SERVICE_VERSION,
    description="Распознавание чертежей ГОСТ/ЕСКД: очистка листа, поиск штампа, текст с честной уверенностью.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _engine_info() -> EngineInfo:
    engine = engine_state.engine()
    return EngineInfo(
        name=config.SERVICE_NAME,
        version=config.SERVICE_VERSION,
        ocr=engine.name,
        ocrAvailable=engine.name != "none",
        ocrEngines=engine_state.attempted or [engine.name],
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    engine = engine_state.engine()
    return HealthResponse(
        service=config.SERVICE_NAME,
        version=config.SERVICE_VERSION,
        opencv=cv2.__version__,
        ocr=engine.name,
        ocrAvailable=engine.name != "none",
        ocrEngines=engine_state.attempted or [engine.name],
        maxPages=config.MAX_PAGES,
        confidenceThreshold=config.CONFIDENCE_THRESHOLD,
    )


@app.get("/")
def root():
    """Короткая карта API: сервис нужен только для распознавания листов."""

    return {
        "service": config.SERVICE_NAME,
        "version": config.SERVICE_VERSION,
        "endpoints": ["/health", "/v1/recognize", "/v1/recognize/roi"],
        "docs": "/docs",
    }


def _load_pages(payloads: Sequence[tuple[bytes, str]]) -> list[PreparedPage]:
    pages: list[PreparedPage] = []
    next_index = 0
    for data, filename in payloads:
        try:
            loaded = pages_from_upload(data, filename, next_index)
        except UnsupportedDocumentError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        if not loaded:
            raise HTTPException(status_code=422, detail=f"Файл «{filename}» не содержит страниц")
        pages.extend(loaded)
        next_index = pages[-1].page_index + 1
    return pages


def _lines_for_page(page: PreparedPage) -> list[TextLine]:
    if page.source == "pdf_vector" and page.vector_lines:
        return page.vector_lines
    engine = engine_state.engine()
    if isinstance(engine, NoopOcrEngine):
        return []
    return merge_stacked_lines(dedupe_lines(ocr_lines(page.image, engine)))


def _page_payload(page: PreparedPage) -> PagePayload:
    zones: list[Zone] = page.layout.zones()
    return PagePayload(
        pageIndex=page.page_index,
        pageId=page.page_id,
        source=page.source,
        width=page.width,
        height=page.height,
        dpi=page.dpi,
        perspectiveCorrected=page.perspective_corrected,
        quality=page.quality_before,
        qualityAfter=page.quality_after,
        imageDataUrl=encode_data_url(page.image),
        zones=zones or [],
        warnings=list(page.warnings),
    )


def _page_notices(page: PreparedPage) -> list[str]:
    sheet = f"Лист {page.page_index + 1}"
    notices = [f"{sheet}: {text}" for text in describe(page.warnings)]
    if page.perspective_corrected:
        notices.append(f"{sheet}: перспектива выправлена автоматически.")
    if "stamp_not_found" in page.warnings:
        notices.append(f"{sheet}: штамп ГОСТ 2.104 не найден — название, код и материал введите вручную.")
    if "frame_not_found" in page.warnings:
        notices.append(f"{sheet}: рамка чертежа не найдена — обрежьте лист по краям и загрузите снова.")
    return notices


@app.post("/v1/recognize", response_model=RecognizeResponse)
async def recognize(files: list[UploadFile] = File(default_factory=list)) -> RecognizeResponse:
    if not files:
        raise HTTPException(status_code=400, detail="Не передано ни одного файла: приложите фото, скан или PDF.")
    if len(files) > config.MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=400,
            detail=f"Слишком много файлов за один раз: максимум {config.MAX_FILES_PER_REQUEST}.",
        )

    request_id = f"req-{uuid.uuid4().hex[:12]}"
    payloads: list[tuple[bytes, str]] = []
    for upload in files:
        data = await upload.read()
        if not data:
            raise HTTPException(status_code=422, detail=f"Файл «{upload.filename or 'без имени'}» пустой.")
        if len(data) > config.MAX_UPLOAD_BYTES:
            limit_mb = config.MAX_UPLOAD_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"Файл больше {limit_mb} МБ. Сожмите фото или загрузите его страницами.",
            )
        payloads.append((data, upload.filename or ""))

    pages = await run_in_threadpool(_load_pages, payloads)
    if not pages:
        raise HTTPException(status_code=422, detail="Не удалось прочитать ни одного листа.")

    for page in pages:
        page_store.put(page)

    candidates: list[Candidate] = []
    title_block: TitleBlock | None = None
    notices: list[str] = []
    for page in pages:
        lines = await run_in_threadpool(_lines_for_page, page)
        page_candidates = build_candidates(lines, page.layout, page.page_index)
        candidates.extend(page_candidates)
        notices.extend(_page_notices(page))
        if title_block is None:
            attempt = parse_title_block(lines, page.layout, page.page_index)
            if attempt is not None:
                title_block = attempt

    if not engine_state.available():
        notices.append(
            "OCR-движок не установлен: векторные PDF и области с текстовым слоем распознаются, "
            "фото — нет. Установите rapidocr-onnxruntime для полного режима."
        )
    if not candidates:
        notices.append("Текст на листах не найден. Выделите размер вручную в «Рентгене» или введите шифр.")

    pages_payload = [_page_payload(page) for page in pages]
    annotations = [
        LegacyAnnotation(
            id=candidate.id,
            pageIndex=candidate.pageIndex,
            raw=candidate.normalizedText,
            kind="other",
            xPercent=candidate.xPercent,
            yPercent=candidate.yPercent,
            confidence=candidate.confidence,
            source="pdf" if candidate.source == "pdf" else "vision-ocr",
            bbox=[candidate.bboxPixels.x, candidate.bboxPixels.y, candidate.bboxPixels.w, candidate.bboxPixels.h],
        )
        for candidate in candidates
    ]

    first = pages[0]
    return RecognizeResponse(
        requestId=request_id,
        engine=_engine_info(),
        pages=pages_payload,
        titleBlock=title_block,
        candidates=candidates,
        warnings=list(dict.fromkeys(notices)),
        page=LegacyPage(width=first.width, height=first.height, dpi=first.dpi),
        annotations=annotations,
    )


def _roi_rect(page: PreparedPage, payload: RoiRequest) -> Box:
    pad_x = payload.w * config.ROI_PADDING_RATIO
    pad_y = payload.h * config.ROI_PADDING_RATIO
    x = max(0.0, payload.x - pad_x)
    y = max(0.0, payload.y - pad_y)
    w = min(100.0 - x, payload.w + 2 * pad_x)
    h = min(100.0 - y, payload.h + 2 * pad_y)
    return Box(
        x=int(round(x / 100 * page.width)),
        y=int(round(y / 100 * page.height)),
        w=max(1, int(round(w / 100 * page.width))),
        h=max(1, int(round(h / 100 * page.height))),
    )


def _read_roi(page: PreparedPage, payload: RoiRequest, rect: Box) -> list[TextLine]:
    if page.vector_lines:
        exact = lines_in_rect(page.vector_lines, rect)
        if exact:
            return exact
    engine = engine_state.engine()
    if isinstance(engine, NoopOcrEngine):
        return []
    rotation = payload.rotation if payload.rotation in (0, 90, 180, 270) else 0
    rotations = tuple(dict.fromkeys([rotation, 0, 90]))
    return ocr_region(page.image, engine, rect, rotations=rotations)


@app.post("/v1/recognize/roi", response_model=RoiResponse)
async def recognize_roi(payload: RoiRequest) -> RoiResponse:
    page = page_store.get(payload.pageId)
    if page is None:
        raise HTTPException(
            status_code=404,
            detail="Лист не найден в текущей сессии распознавания. Загрузите чертёж заново.",
        )

    rect = _roi_rect(page, payload)
    lines = await run_in_threadpool(_read_roi, page, payload, rect)
    candidates = build_candidates(merge_stacked_lines(dedupe_lines(lines)), page.layout, page.page_index, strict=False)

    warnings: list[str] = []
    if not engine_state.available() and not page.vector_lines:
        warnings.append("OCR-движок не установлен: распознавание фото недоступно, введите шифр вручную.")
    if not candidates:
        warnings.append("В выделенной области текст не найден. Выделите шире или введите обозначение вручную.")

    return RoiResponse(pageId=page.page_id, candidates=candidates, warnings=warnings)
