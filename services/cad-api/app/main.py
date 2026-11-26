"""FastAPI entry point of the IkGuide 3D CAD service (``npm run dev:cad`` → port 8001)."""

from __future__ import annotations

import trimesh
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import (
    COLOR_ACTIVE_FILL,
    COLOR_ACTIVE_LINE,
    COLOR_ATTENTION,
    COLOR_INK,
    COLOR_PAPER,
    MAX_PARTS,
    MAX_UPLOAD_BYTES,
    SERVICE_NAME,
    SERVICE_VERSION,
    SUPPORTED_FORMATS,
)
from .loader import CadLoadError, step_engine
from .pipeline import import_cad, rerender, session_payload
from .schemas import ErrorOut, HealthOut, ImportOut, RenderViewIn, RenderViewOut
from .session import store

app = FastAPI(
    title="IkGuide CAD API",
    version=SERVICE_VERSION,
    description="Импорт 3D-сборок, автоматический порядок сборки и векторные схемы IKEA 2.0.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ = __version__


def _health() -> HealthOut:
    enabled, engine = step_engine()
    return HealthOut(
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        trimesh=getattr(trimesh, "__version__", "unknown"),
        stepEnabled=enabled,
        stepEngine=engine,
        formats=list(SUPPORTED_FORMATS),
        maxUploadMb=MAX_UPLOAD_BYTES // (1024 * 1024),
        maxParts=MAX_PARTS,
        svgPalette={
            "ink": COLOR_INK,
            "paper": COLOR_PAPER,
            "activeFill": COLOR_ACTIVE_FILL,
            "activeLine": COLOR_ACTIVE_LINE,
            "attention": COLOR_ATTENTION,
        },
        sessions=len(store._items),  # noqa: SLF001 - read-only diagnostic
    )


@app.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    return _health()


@app.get("/v1/cad/health", response_model=HealthOut)
def health_prefixed() -> HealthOut:
    """Alias so the browser can reach it through the Vite `/v1/cad` proxy."""
    return _health()


def _error(error: CadLoadError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content=ErrorOut(detail=error.message, code=error.code).model_dump(),
    )


@app.post("/v1/cad/import", response_model=ImportOut, responses={422: {"model": ErrorOut}})
async def import_assembly(file: UploadFile = File(..., description="STEP, STP, STL, OBJ, GLB или GLTF")):
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        return _error(
            CadLoadError(
                f"Файл больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ. Сохраните модель с меньшим числом треугольников.",
                code="file_too_large",
                status=413,
            )
        )
    try:
        session = import_cad(file.filename or "assembly", data)
    except CadLoadError as error:
        return _error(error)
    return session_payload(session)


@app.post("/v1/cad/render-view", response_model=RenderViewOut, responses={404: {"model": ErrorOut}})
def render_view(request: RenderViewIn) -> RenderViewOut | JSONResponse:
    try:
        svg, triangles = rerender(
            request.sessionId,
            azimuth=request.azimuth,
            elevation=request.elevation,
            active_ids=request.activePartIds,
            installed_ids=request.installedPartIds,
            ghost_ids=request.ghostPartIds,
            explode=request.explode,
            attention=request.attention,
            caption=request.caption,
        )
    except CadLoadError as error:
        return _error(error)
    return RenderViewOut(
        svg=svg,
        azimuth=request.azimuth,
        elevation=request.elevation,
        triangles=triangles,
    )
