"""Pydantic models of the /v1/recognize contract.

The legacy fields of the stage-1 contract (`page`, `annotations`) are kept next to the richer
stage-2 payload, so an old client keeps working while the TS builder consumes the new shape.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Region = Literal["field", "title_block", "tech_req"]
ZoneKind = Literal["frame", "drawing", "title_block", "tech_req"]
PageSource = Literal["pdf_vector", "pdf_raster", "image"]
AnnotationKind = Literal[
    "thread",
    "fit",
    "roughness",
    "weld",
    "chamfer",
    "holeGroup",
    "radius",
    "dimension",
    "other",
]


class BBoxPercent(BaseModel):
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    w: float = Field(ge=0, le=100)
    h: float = Field(ge=0, le=100)


class PixelBox(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1)
    h: int = Field(ge=1)


class QualityMetrics(BaseModel):
    """Grayscale statistics used by the shop-floor UI to explain a bad photo."""

    brightness: float = Field(ge=0, le=255)
    contrast: float = Field(ge=0)
    sharpness: float = Field(ge=0)


class QualityReport(BaseModel):
    metrics: QualityMetrics
    warnings: list[str] = Field(default_factory=list)


class Zone(BaseModel):
    kind: ZoneKind
    bboxPercent: BBoxPercent


class PagePayload(BaseModel):
    pageIndex: int = Field(ge=0)
    pageId: str
    source: PageSource
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    dpi: int = Field(gt=0)
    perspectiveCorrected: bool
    quality: QualityReport
    qualityAfter: QualityReport | None = None
    imageDataUrl: str
    zones: list[Zone] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    upscale: float = Field(default=1.0, ge=1.0, le=4.0, description="во сколько раз лист увеличен перед OCR")


class Candidate(BaseModel):
    id: str
    pageIndex: int = Field(default=0, ge=0)
    rawText: str
    normalizedText: str
    xPercent: float = Field(ge=0, le=100)
    yPercent: float = Field(ge=0, le=100)
    bboxPercent: BBoxPercent
    bboxPixels: PixelBox
    confidence: float = Field(ge=0, le=1)
    ambiguousOptions: list[str] = Field(default_factory=list)
    region: Region = "field"
    source: Literal["pdf", "ocr"] = "ocr"
    rotation: int = 0


class LegacyAnnotation(BaseModel):
    """Stage-1 mirror: `kind` stays "other" because classification belongs to the TS GOST core."""

    id: str
    pageIndex: int = 0
    raw: str
    kind: AnnotationKind = "other"
    xPercent: float = Field(ge=0, le=100)
    yPercent: float = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    source: str
    bbox: list[int] = Field(default_factory=list, description="[x, y, w, h] in page pixels")


class LegacyPage(BaseModel):
    width: int
    height: int
    dpi: int


class TitleBlock(BaseModel):
    name: str | None = None
    code: str | None = None
    material: str | None = None
    scale: str | None = None
    sheet: str | None = None
    confidence: float = Field(default=0.0, ge=0, le=1)
    rawLines: list[str] = Field(default_factory=list)


class BomRowPayload(BaseModel):
    """Строка таблицы позиций на поле чертежа: что взять и сколько."""

    pageIndex: int = Field(default=0, ge=0)
    position: int | None = Field(default=None, ge=0)
    designation: str | None = None
    name: str = Field(min_length=1)
    quantity: int | None = Field(default=None, ge=0)
    xPercent: float = Field(ge=0, le=100)
    yPercent: float = Field(ge=0, le=100)
    bboxPercent: BBoxPercent


class SheetViewPayload(BaseModel):
    """Подпись вида на листе: «Спереди», «Сбоку», «Сверху», «Изометрия», «Разрез А-А»."""

    pageIndex: int = Field(default=0, ge=0)
    name: str = Field(min_length=1)
    xPercent: float = Field(ge=0, le=100)
    yPercent: float = Field(ge=0, le=100)
    bboxPercent: BBoxPercent


class EngineInfo(BaseModel):
    name: str
    version: str
    ocr: str
    ocrAvailable: bool
    ocrEngines: list[str] = Field(default_factory=list)


class RecognizeResponse(BaseModel):
    schemaVersion: Literal["1.0"] = "1.0"
    requestId: str
    engine: EngineInfo
    pages: list[PagePayload]
    titleBlock: TitleBlock | None = None
    candidates: list[Candidate] = Field(default_factory=list)
    bomRows: list[BomRowPayload] = Field(default_factory=list)
    views: list[SheetViewPayload] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    # --- stage-1 compatibility ---------------------------------------------------------
    page: LegacyPage | None = None
    annotations: list[LegacyAnnotation] = Field(default_factory=list)


class RoiRequest(BaseModel):
    pageId: str = Field(min_length=4)
    x: float = Field(ge=0, lt=100)
    y: float = Field(ge=0, lt=100)
    w: float = Field(gt=0, le=100)
    h: float = Field(gt=0, le=100)
    rotation: int = Field(default=0)

    @field_validator("w", "h")
    @classmethod
    def _minimum_size(cls, value: float) -> float:
        if value < 0.4:
            raise ValueError("Область слишком маленькая: выделите прямоугольник не меньше 0,4 % листа.")
        return value


class RoiResponse(BaseModel):
    pageId: str
    candidates: list[Candidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    opencv: str
    ocr: str
    ocrAvailable: bool
    ocrEngines: list[str]
    maxPages: int
    confidenceThreshold: float
