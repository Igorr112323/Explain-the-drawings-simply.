"""Turns a CAD file into normalised parts (millimetres, Y-up, centred) plus one packed GLB.

Formats:
* ``.stl`` / ``.obj`` / ``.glb`` / ``.gltf`` — read with trimesh;
* ``.step`` / ``.stp`` — tessellated with cascadio (OCCT compiled to WebAssembly, no OpenGL),
  while the product tree is parsed from the STEP text so part names survive the conversion.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

import numpy as np
import trimesh

from .config import MAX_PARTS, MAX_TRIANGLES, STEP_FORMATS, SUPPORTED_FORMATS
from .models import CadModel, CadPart
from .names import extract_notation, group_key, humanize, slugify, unique_slug

_INSTANCE_SUFFIX = re.compile(r"(?:[\s_]+|:|<)(\d{1,3})>?$")
from .step_names import is_generic_name, parse_step_tree

try:  # optional STEP engine
    import cascadio  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    cascadio = None

STEEL_DENSITY_KG_MM3 = 7.85e-6
MAX_PART_FACES = 6000
UNIT_HINT_MM = 5.0

# Z-up (CAD) to Y-up (three.js): (x, y, z) -> (x, z, -y)
Z_UP_TO_Y_UP = np.array(
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
)


class CadLoadError(Exception):
    """A user-facing import error; the HTTP layer turns it into a readable 4xx answer."""

    def __init__(self, message: str, code: str = "cad_unreadable", status: int = 422) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def step_engine() -> tuple[bool, str]:
    """Availability of the optional STEP tessellator."""
    if cascadio is None:
        return False, "none"
    version = getattr(cascadio, "__version__", "unknown")
    return True, f"cascadio {version}"


def supported_formats() -> tuple[str, ...]:
    return SUPPORTED_FORMATS


def detect_format(filename: str, data: bytes) -> str:
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix in SUPPORTED_FORMATS:
        return suffix
    head = data[:64]
    if head.startswith(b"glTF"):
        return "glb"
    if head.lstrip().startswith(b"ISO-10303-21"):
        return "step"
    if head.lstrip()[:5].lower() in (b"solid",):
        return "stl"
    if len(data) >= 84:
        triangles = int.from_bytes(data[80:84], "little")
        if triangles > 0 and 84 + triangles * 50 <= len(data):
            return "stl"
    sample = data[:4096]
    if b"\nv " in sample or sample.startswith(b"v ") or b"\no " in sample or b"\ng " in sample:
        return "obj"
    raise CadLoadError(
        "Формат не распознан. Поддерживаются STEP, STP, STL, OBJ, GLB и GLTF.",
        code="unsupported_format",
        status=415,
    )


@dataclass
class LoadedAssembly:
    parts: list[CadPart]
    glb_bytes: bytes
    size_mm: tuple[float, float, float]
    mass_kg: float
    kind: str
    source_format: str
    assembly_name: str
    unit_scale: float
    triangle_count: int
    warnings: list[str]


def _scene_parts(scene: trimesh.Scene) -> list[tuple[str, trimesh.Trimesh]]:
    """Flattens a trimesh scene into (name, mesh) pairs with baked world transforms."""
    collected: list[tuple[str, trimesh.Trimesh]] = []
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node_name]
        geometry = scene.geometry.get(geometry_name)
        if geometry is None or geometry.is_empty:
            continue
        mesh = geometry.copy()
        mesh.apply_transform(transform)
        display = geometry_name if node_name in ("world", "", None) else node_name
        if display in ("world", "", None) or is_generic_name(str(display)):
            display = geometry_name or display
        collected.append((str(display), mesh))
    return collected


def _parse_obj_groups(text: str) -> list[tuple[str, trimesh.Trimesh]]:
    """Splits a Wavefront OBJ by its ``o`` / ``g`` groups, so each part keeps its own name."""
    vertices: list[tuple[float, float, float]] = []
    groups: list[tuple[str, list[tuple[int, int, int]]]] = []
    current_name = "Деталь"
    current_faces: list[tuple[int, int, int]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        head, _, rest = line.partition(" ")
        if head == "v":
            parts = rest.split()
            if len(parts) >= 3:
                vertices.append((float(parts[0]), float(parts[1]), float(parts[2])))
        elif head in ("o", "g"):
            if current_faces:
                groups.append((current_name, current_faces))
                current_faces = []
            current_name = rest.strip() or current_name
        elif head == "f":
            indices: list[int] = []
            for token in rest.split():
                index = int(token.split("/")[0])
                indices.append(index - 1 if index > 0 else len(vertices) + index)
            for offset in range(1, len(indices) - 1):
                current_faces.append((indices[0], indices[offset], indices[offset + 1]))
    if current_faces:
        groups.append((current_name, current_faces))

    built: list[tuple[str, trimesh.Trimesh]] = []
    for name, faces in groups:
        mesh = trimesh.Trimesh(vertices=np.asarray(vertices, dtype=float), faces=np.asarray(faces, dtype=np.int64), process=False)
        if len(mesh.faces) == 0:
            continue
        built.append((name, mesh))
    return built


def _load_obj_scene(data: bytes) -> trimesh.Scene:
    text = data.decode("utf-8", errors="ignore")
    groups = _parse_obj_groups(text)
    scene = trimesh.Scene()
    if not groups:
        raise CadLoadError("В OBJ не нашлось ни одного полигона.", code="cad_empty")
    for index, (name, mesh) in enumerate(groups):
        node = name if len(groups) > 1 else name
        scene.add_geometry(mesh, geom_name=f"{node}", node_name=f"{node}", transform=np.eye(4))
    return scene


def _load_mesh_scene(data: bytes, file_type: str) -> trimesh.Scene:
    if file_type == "obj":
        return _load_obj_scene(data)
    try:
        loaded = trimesh.load(io.BytesIO(data), file_type=file_type, force="scene", process=False)
    except Exception as error:  # trimesh raises many different exception types
        raise CadLoadError(
            f"Не удалось прочитать {file_type.upper()}: файл повреждён или это другая версия формата.",
            code="cad_unreadable",
        ) from error
    if isinstance(loaded, trimesh.Trimesh):
        loaded = trimesh.Scene(loaded)
    if not isinstance(loaded, trimesh.Scene) or not loaded.geometry:
        raise CadLoadError("В файле нет ни одного тела — сохраните модель с геометрией.", code="cad_empty")
    return loaded


def _tessellate_step(data: bytes) -> trimesh.Scene:
    enabled, engine = step_engine()
    if not enabled:
        raise CadLoadError(
            "STEP-движок не установлен. Установите его командой «npm run install:cad -- --step» "
            "или сохраните модель в STL/GLB.",
            code="step_engine_missing",
        )
    try:
        glb = cascadio.to_glb_bytes(data)  # type: ignore[union-attr]
    except Exception as error:
        raise CadLoadError(
            f"Движок ({engine}) не смог прочитать STEP. Проверьте файл или сохраните его в GLB/STL.",
            code="step_engine_failed",
        ) from error
    if not glb:
        raise CadLoadError(
            "Движок не смог прочитать геометрию STEP: в файле нет тел или он повреждён. "
            "Сохраните сборку в GLB/STL и повторите импорт.",
            code="step_empty",
        )
    try:
        scene = trimesh.load(io.BytesIO(glb), file_type="glb", force="scene", process=False)
    except Exception as error:  # pragma: no cover - defensive
        raise CadLoadError("Не удалось разобрать результат конвертации STEP.", code="step_engine_failed") from error
    if isinstance(scene, trimesh.Trimesh):
        scene = trimesh.Scene(scene)
    if not scene.geometry:
        raise CadLoadError(
            "В STEP не нашлось тел для отображения. Сохраните сборку в GLB/STL и повторите импорт.",
            code="step_empty",
        )
    return scene


def _rename_from_step(parts: list[CadPart], step_names: list[str]) -> None:
    """Replaces anonymous converter names with the real products from the STEP text."""
    if not step_names:
        return
    candidates = [name for name in step_names if name and not is_generic_name(name)]
    if not candidates:
        return
    for index, part in enumerate(parts):
        if not is_generic_name(part.name):
            continue
        part.name = candidates[index] if index < len(candidates) else candidates[-1]


def _strip_instance_suffixes(parts: list[CadPart]) -> None:
    """«Болт М6x20 1…4» → one readable name; uniqueness lives in ``node_name``."""
    stems = {_INSTANCE_SUFFIX.sub("", part.name) for part in parts}
    for part in parts:
        stem = _INSTANCE_SUFFIX.sub("", part.name).strip()
        if stem and stem != part.name and stem in stems:
            part.name = stem


def _scale_for_meshes(parts: list[CadPart], warnings: list[str]) -> float:
    extents = [max(part.size) for part in parts if part.size]
    if not extents:
        return 1.0
    largest = max(extents)
    if 0.0 < largest < UNIT_HINT_MM:
        warnings.append("Модель меньше 5 мм — единицы, похоже, метры: масштаб увеличен в 1000 раз.")
        return 1000.0
    return 1.0


def _simplify(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, bool]:
    if len(mesh.faces) <= MAX_PART_FACES:
        return mesh, False
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=MAX_PART_FACES)
        if simplified is not None and len(simplified.faces) > 0:
            return simplified, True
    except Exception:  # pragma: no cover - optional simplification backend
        pass
    return mesh, False


def load_model(filename: str, data: bytes) -> LoadedAssembly:
    """Reads, normalises and packs an assembly. Raises :class:`CadLoadError` on any problem."""
    if not data:
        raise CadLoadError("Файл пустой.", code="cad_empty")
    file_type = detect_format(filename, data)
    warnings: list[str] = []

    step_names: list[str] = []
    unit_scale = 1.0
    assembly_name = humanize(filename.rsplit("/", 1)[-1], "Сборка")
    kind = "step" if file_type in STEP_FORMATS else "mesh"

    if file_type in STEP_FORMATS:
        try:
            text = data.decode("utf-8", errors="ignore")
        except Exception:  # pragma: no cover - decode with errors="ignore" never raises
            text = ""
        tree = parse_step_tree(text)
        # Leaves are the parts; the single root is the assembly itself.
        leaves = [product.name for product in tree.products if product.parent_pd is not None]
        step_names = leaves or tree.names
        unit_scale = tree.unit_scale
        if tree.assembly_name and not is_generic_name(tree.assembly_name):
            assembly_name = tree.assembly_name
        scene = _tessellate_step(data)
    else:
        scene = _load_mesh_scene(data, file_type)

    raw_parts = _scene_parts(scene)
    if not raw_parts:
        raise CadLoadError("В файле нет ни одного тела с геометрией.", code="cad_empty")

    parts: list[CadPart] = []
    used_slugs: set[str] = set()
    for display_name, mesh in raw_parts:
        mesh.merge_vertices()
        mesh.update_faces(mesh.nondegenerate_faces())
        if mesh.is_empty or len(mesh.faces) == 0:
            continue
        part = CadPart(id="", name=humanize(display_name), node_name="", mesh=mesh)
        part.refresh_bounds()
        parts.append(part)

    if not parts:
        raise CadLoadError("Тела в файле пустые (нет треугольников).", code="cad_empty")

    _strip_instance_suffixes(parts)
    if kind == "step":
        _rename_from_step(parts, step_names)
        for part in parts:
            part.name = humanize(part.name, "Деталь")
    else:
        unit_scale = _scale_for_meshes(parts, warnings)
        if len(parts) == 1 and is_generic_name(parts[0].name):
            parts[0].name = humanize(filename.rsplit("/", 1)[-1], "Деталь")

    # Units and orientation
    if unit_scale != 1.0:
        for part in parts:
            part.mesh.apply_scale(unit_scale)  # type: ignore[union-attr]
        warnings.append(f"Единицы STEP: {unit_scale:g}× пересчёт в миллиметры.")

    for position, part in enumerate(parts):
        part.mesh.apply_transform(Z_UP_TO_Y_UP)  # type: ignore[union-attr]
        part.mesh, simplified = _simplify(part.mesh)  # type: ignore[arg-type]
        if simplified:
            warnings.append(f"«{part.name}» упрощена для отображения (до {MAX_PART_FACES} граней).")
        if position >= MAX_PARTS:
            break

    # Keep the largest parts when a file is too fragmented.
    parts.sort(key=lambda item: (-_mesh_volume(item.mesh), item.name.lower()))
    if len(parts) > MAX_PARTS:
        warnings.append(f"В сборке больше {MAX_PARTS} тел: показаны первые {MAX_PARTS}.")
        parts = parts[:MAX_PARTS]

    total_triangles = sum(len(part.mesh.faces) for part in parts)  # type: ignore[union-attr]
    if total_triangles > MAX_TRIANGLES:  # pragma: no cover - guarded by per-part simplification
        warnings.append("Модель очень подробная: часть граней не попала в диаграммы.")

    # Centre the assembly around the origin so orbit controls feel natural.
    minima: list[np.ndarray] = []
    maxima: list[np.ndarray] = []
    for part in parts:
        bounds = np.asarray(part.mesh.bounds, dtype=float)  # type: ignore[union-attr]
        minima.append(bounds[0])
        maxima.append(bounds[1])
    lower = np.min(np.stack(minima), axis=0)
    upper = np.max(np.stack(maxima), axis=0)
    offset = (lower + upper) / 2
    if np.any(np.abs(offset) > 1e-9):
        for part in parts:
            part.mesh.apply_translation(-offset)  # type: ignore[union-attr]

    for index, part in enumerate(parts):
        part.id = f"part-{index + 1}"
        part.node_name = unique_slug(slugify(part.name, f"part-{index + 1}"), used_slugs)
        part.refresh_bounds()
        part.notation = extract_notation(part.name)
        part.group_key = group_key(part.name, part.notation, part.size)

    size = tuple(float(value) for value in (upper - lower))
    volume = sum(part.volume_mm3 for part in parts)
    mass = volume * STEEL_DENSITY_KG_MM3
    if mass > 0:
        warnings.append(
            "Масса оценена по стали 7,85 г/см³ — уточните материал в штампе или спецификации."
        )

    glb_bytes = pack_glb(parts)
    return LoadedAssembly(
        parts=parts,
        glb_bytes=glb_bytes,
        size_mm=(size[0], size[1], size[2]),
        mass_kg=mass,
        kind=kind,
        source_format="step" if kind == "step" else file_type,
        assembly_name=assembly_name,
        unit_scale=unit_scale,
        triangle_count=sum(part.triangle_count for part in parts),
        warnings=warnings,
    )


def _mesh_volume(mesh: object | None) -> float:
    if mesh is None:
        return 0.0
    try:
        return float(abs(mesh.volume))  # type: ignore[union-attr]
    except Exception:  # pragma: no cover - defensive
        return 0.0


def pack_glb(parts: list[CadPart]) -> bytes:
    """Packs every part into one GLB with stable node names for per-part control in three.js."""
    scene = trimesh.Scene()
    for part in parts:
        if part.mesh is None:
            continue
        mesh = part.mesh.copy()  # type: ignore[union-attr]
        scene.add_geometry(mesh, geom_name=part.node_name, node_name=part.node_name, transform=np.eye(4))
    if not scene.geometry:
        raise CadLoadError("Нечего упаковать в GLB: сборка пуста.", code="cad_empty")
    exported = scene.export(file_type="glb")
    if isinstance(exported, str):  # pragma: no cover - trimesh returns bytes for glb
        return exported.encode("utf-8")
    return bytes(exported)


def model_payload(loaded: LoadedAssembly) -> CadModel:
    """Wraps the loader result in the model dataclass used by the API layer."""
    return CadModel(
        kind=loaded.kind,
        unit_scale=loaded.unit_scale,
        parts=loaded.parts,
        steps=[],
        glb_bytes=loaded.glb_bytes,
        size_mm=loaded.size_mm,
        mass_kg=loaded.mass_kg,
        warnings=list(loaded.warnings),
        source_format=loaded.source_format,
        assembly_name=loaded.assembly_name,
        triangle_count=loaded.triangle_count,
    )
