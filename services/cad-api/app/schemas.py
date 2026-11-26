"""Pydantic models that document and validate the HTTP contract."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["base", "part", "fastener"]
StepKind = Literal["base", "cover", "fastener", "part"]


class HealthOut(BaseModel):
    status: str = "ok"
    service: str
    version: str
    trimesh: str
    stepEnabled: bool
    stepEngine: str
    formats: list[str]
    maxUploadMb: int
    maxParts: int
    svgPalette: dict[str, str]
    sessions: int


class BboxOut(BaseModel):
    min: list[float]
    max: list[float]
    size: list[float]


class PartOut(BaseModel):
    id: str
    name: str
    nodeName: str
    role: Role
    bbox: BboxOut
    volumeMm3: float
    centroid: list[float]
    triangleCount: int
    explosionVector: list[float]
    groupKey: str
    notation: str | None = None


class StepOut(BaseModel):
    number: int
    kind: StepKind
    title: str
    workerText: str
    partIds: list[str]
    count: int
    explosionVector: list[float]
    azimuth: float
    elevation: float
    fastenerKey: str | None = None
    notation: str | None = None
    attention: str | None = None
    svg: str


class AssemblyOut(BaseModel):
    name: str
    filename: str
    sourceFormat: str
    unitScale: float
    sizeMm: list[float]
    massKg: float


class StatsOut(BaseModel):
    parts: int
    fasteners: int
    steps: int
    triangles: int


class ImportOut(BaseModel):
    schemaVersion: Literal["1.0"] = "1.0"
    sessionId: str
    assembly: AssemblyOut
    parts: list[PartOut]
    steps: list[StepOut]
    overviewSvg: str
    glbDataUrl: str
    warnings: list[str] = Field(default_factory=list)
    stats: StatsOut


class RenderViewIn(BaseModel):
    sessionId: str
    azimuth: float = 35.0
    elevation: float = 26.0
    explode: float = 0.45
    activePartIds: list[str] = Field(default_factory=list)
    installedPartIds: list[str] = Field(default_factory=list)
    ghostPartIds: list[str] = Field(default_factory=list)
    attention: str | None = None
    caption: str | None = None


class RenderViewOut(BaseModel):
    svg: str
    azimuth: float
    elevation: float
    triangles: int


class ErrorOut(BaseModel):
    detail: str
    code: str
