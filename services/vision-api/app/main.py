"""HTTP API: распознавание листов, ROI для «Рентгена» и цеховой QR-мост.

Распознавание отдаёт только геометрию и текст с честной уверенностью; превращение
обозначений в инструкцию IKEA делает TypeScript (`@ikguide/builder`), где живёт ядро ГОСТ.

С этапа 5 сервис ещё и цеховой сервер публикаций: `POST /v1/guides` кладёт полную
инструкцию (с 3D-моделью) на диск, `GET /v1/guides/{id}` отдаёт её телефону рабочего, а
`GET /v1/network-info` подсказывает инженеру LAN-адрес для QR-кода.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from typing import Sequence

import cv2
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
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
from .guides import GuideError, GuideStore
from .layout import Box
from .network import network_info
from .ocr import NoopOcrEngine, OcrEngine, create_ocr_engine
from .pages import (
    PageStore,
    PreparedPage,
    UnsupportedDocumentError,
    pages_from_upload,
)
from .preprocessing import encode_data_url
from .quality import describe
from .studio_static import mount_studio, resolve_studio_dist
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
guide_store = GuideStore()

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


# ---------------------------------------------------------------- публикации цеха (этап 5)


class GuideSummaryOut(BaseModel):
    """Карточка опубликованной инструкции."""

    id: str
    title: str
    drawingCode: str
    revision: str = ""
    createdAt: str
    sizeBytes: int
    has3d: bool
    steps: int
    url: str


class GuidePublishOut(GuideSummaryOut):
    """Ответ на публикацию: короткий id и готовая ссылка для QR."""

    absoluteUrl: str
    guideId: str = ""
    deduplicated: bool = False


class GuideListOut(BaseModel):
    count: int
    guides: list[GuideSummaryOut]


class NetworkAddressOut(BaseModel):
    ip: str
    kind: str
    primary: bool = False


class NetworkInfoOut(BaseModel):
    status: str = "ok"
    hostname: str
    primary: str
    primaryIsLan: bool = False
    addresses: list[NetworkAddressOut] = Field(default_factory=list)
    guidePort: int = 8000
    suggestedApiBase: str
    studioAvailable: bool = False


def _guide_summary_out(summary) -> GuideSummaryOut:
    data = summary.as_dict()
    return GuideSummaryOut(**data)


def _http_error(error: GuideError) -> HTTPException:
    return HTTPException(status_code=error.status, detail=error.message)


_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"}


def _public_base(request: Request) -> str:
    """Адрес, по которому сервис виден цеху, а не самому себе.

    Инженер публикует инструкцию с ноутбука цеха через `http://127.0.0.1:8000` — такая ссылка
    бессмысленна для телефона, поэтому loopback подменяется на LAN-адрес из `network_info`.
    """

    base = str(request.base_url).rstrip("/")
    host = request.url.hostname or ""
    if host not in _LOOPBACK_HOSTS:
        return base
    try:
        suggested = network_info(request.url.port).get("suggestedApiBase")
    except OSError:
        return base
    return suggested.rstrip("/") if isinstance(suggested, str) and suggested else base


@app.post("/v1/guides", response_model=GuidePublishOut, status_code=201)
async def publish_guide(request: Request) -> GuidePublishOut:
    """Принимает полный `IkGuideDocument` (вместе с 3D) и возвращает короткий id."""

    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            declared_bytes = int(declared)
        except ValueError:
            raise HTTPException(status_code=400, detail="Некорректный заголовок Content-Length.") from None
        if declared_bytes > config.MAX_GUIDE_BYTES:
            limit_mb = config.MAX_GUIDE_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"Инструкция больше {limit_mb} МБ. Сожмите 3D-модель или опубликуйте версию без .glb.",
            )

    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Пустой запрос: пришлите JSON инструкции .ikguide.json.")
    if len(raw) > config.MAX_GUIDE_BYTES:
        limit_mb = config.MAX_GUIDE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"Инструкция больше {limit_mb} МБ. Сожмите 3D-модель или опубликуйте версию без .glb.",
        )

    try:
        document = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=400,
            detail=f"Не удалось разобрать JSON инструкции: {error.msg} (строка {error.lineno}).",
        ) from None

    before = {summary.sha256 for summary in guide_store.summaries(limit=guide_store.max_guides)}
    try:
        summary = await run_in_threadpool(guide_store.save, document, len(raw))
    except GuideError as error:
        raise _http_error(error) from None

    absolute = f"{_public_base(request)}{summary.as_dict()['url']}"
    payload = _guide_summary_out(summary).model_dump()
    payload.update(
        {
            "absoluteUrl": absolute,
            "guideId": summary.id,
            "deduplicated": summary.sha256 in before,
        }
    )
    return GuidePublishOut(**payload)


@app.get("/v1/guides", response_model=GuideListOut)
def list_guides(limit: int = config.GUIDES_LIST_LIMIT) -> GuideListOut:
    """Последние опубликованные инструкции цеха (без тяжёлых тел документов)."""

    capped = max(1, min(limit, guide_store.max_guides))
    summaries = guide_store.summaries(limit=capped)
    guides = [_guide_summary_out(summary) for summary in summaries]
    return GuideListOut(count=len(guides), guides=guides)


@app.get("/v1/guides/{guide_id}")
def get_guide(guide_id: str) -> JSONResponse:
    """Отдаёт сохранённый `IkGuideDocument` целиком — телефон рабочего скачает его по Wi-Fi."""

    try:
        document = guide_store.get(guide_id)
    except GuideError as error:
        raise _http_error(error) from None
    if document is None:
        raise HTTPException(
            status_code=404,
            detail="Инструкция не найдена: возможно, её удалили с цехового сервера или ссылка устарела.",
        )
    return JSONResponse(
        content=document,
        headers={"cache-control": "public, max-age=60", "access-control-allow-origin": "*"},
    )


@app.get("/v1/network-info", response_model=NetworkInfoOut)
def network_info_endpoint(request: Request) -> NetworkInfoOut:
    """LAN-адреса ПК: из них студия собирает ссылку `http://<ip>:8000/?guideId=…`."""

    port = request.url.port or 8000
    info = network_info(service_port=port)
    info["studioAvailable"] = resolve_studio_dist() is not None
    return NetworkInfoOut(**info)


@app.get("/")
def root(request: Request):
    """JSON для API-клиентов, собранная студия — для браузера/Safari на iPhone."""

    dist = resolve_studio_dist()
    accept = request.headers.get("accept", "").lower()
    # Сканер в телефоне и встроенный WebView часто присылают `*/*` вместо `text/html`: ссылка из QR
    # должна открывать приложение, а не JSON. `*/*` без ссылки и явный `application/json` — это
    # API-клиенты, им по-прежнему отвечает JSON.
    explicit_json = "application/json" in accept and "text/html" not in accept
    has_guide_link = "guideId" in request.query_params or "guide" in request.query_params
    wants_html = "text/html" in accept or (has_guide_link and not explicit_json)
    if dist is not None and wants_html and not explicit_json:
        return FileResponse(dist / "index.html")

    return {
        "service": config.SERVICE_NAME,
        "version": config.SERVICE_VERSION,
        "endpoints": [
            "/health",
            "/v1/recognize",
            "/v1/recognize/roi",
            "/v1/guides",
            "/v1/guides/{id}",
            "/v1/network-info",
        ],
        "studio": "http://<lan-ip>:8000/?guideId=<id>&api=http://<lan-ip>:8000" if dist is not None else None,
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


# --- раздача собранной веб-студии (этап 5) --------------------------------------------
# Регистрируется последней: маршруты /v1/... и /health уже объявлены и поэтому выигрывают
# у статики. Если папки dist рядом нет — сервис работает как обычно, без статики.
_STUDIO_DIST = resolve_studio_dist()
if _STUDIO_DIST is not None:
    mount_studio(app, _STUDIO_DIST)
