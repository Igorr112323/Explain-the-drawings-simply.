"""Data passed between the loader, the sequencer, the SVG renderer and HTTP layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

Vector3 = tuple[float, float, float]
PartRole = Literal["base", "part", "fastener"]
StepKind = Literal["base", "cover", "fastener", "part"]


@dataclass
class CadPart:
    """One solid of the imported model, already normalised to millimetres and Y-up."""

    id: str
    name: str
    node_name: str
    role: PartRole = "part"
    mesh: object | None = None  # trimesh.Trimesh
    bbox_min: Vector3 = (0.0, 0.0, 0.0)
    bbox_max: Vector3 = (0.0, 0.0, 0.0)
    volume_mm3: float = 0.0
    centroid: Vector3 = (0.0, 0.0, 0.0)
    group_key: str = ""
    explosion_vector: Vector3 = (0.0, 1.0, 0.0)
    notation: str | None = None
    triangle_count: int = 0

    @property
    def size(self) -> Vector3:
        return (
            max(0.0, self.bbox_max[0] - self.bbox_min[0]),
            max(0.0, self.bbox_max[1] - self.bbox_min[1]),
            max(0.0, self.bbox_max[2] - self.bbox_min[2]),
        )

    @property
    def center(self) -> Vector3:
        return (
            (self.bbox_min[0] + self.bbox_max[0]) / 2,
            (self.bbox_min[1] + self.bbox_max[1]) / 2,
            (self.bbox_min[2] + self.bbox_max[2]) / 2,
        )

    @property
    def diagonal(self) -> float:
        sx, sy, sz = self.size
        return float((sx * sx + sy * sy + sz * sz) ** 0.5)

    def refresh_bounds(self) -> None:
        if self.mesh is None:
            return
        bounds = np.asarray(self.mesh.bounds, dtype=float)
        self.bbox_min = tuple(float(value) for value in bounds[0])
        self.bbox_max = tuple(float(value) for value in bounds[1])
        self.centroid = tuple(float(value) for value in np.asarray(self.mesh.centroid, dtype=float))
        self.triangle_count = int(len(self.mesh.faces))
        try:
            volume = float(abs(self.mesh.volume))
        except Exception:  # pragma: no cover - defensive, non-watertight meshes
            volume = 0.0
        if not np.isfinite(volume) or volume <= 0.0:
            try:
                volume = float(abs(self.mesh.convex_hull.volume))
            except Exception:  # pragma: no cover - degenerate meshes
                volume = 0.0
        self.volume_mm3 = volume


@dataclass
class AssemblyStep:
    """One step of the assembly sequence produced by the disassembly algorithm."""

    number: int
    kind: StepKind
    title: str
    part_ids: list[str]
    explosion_vector: Vector3
    azimuth: float
    elevation: float
    fastener_key: str | None = None
    notation: str | None = None
    attention: str | None = None
    svg: str = ""
    worker_text: str = ""

    @property
    def count(self) -> int:
        return len(self.part_ids)


@dataclass
class CadModel:
    """Normalised import result before the HTTP layer adds a session id."""

    kind: str
    unit_scale: float
    parts: list[CadPart]
    steps: list[AssemblyStep]
    glb_bytes: bytes
    size_mm: Vector3
    mass_kg: float
    warnings: list[str] = field(default_factory=list)
    source_format: str = "glb"
    assembly_name: str = "Сборка"
    triangle_count: int = 0
