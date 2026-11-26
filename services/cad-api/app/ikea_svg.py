"""IKEA 2.0 vector diagrams: hidden-line removal by painter's algorithm plus crease edges.

Every visible part is drawn facet by facet from far to near: first the fill (which hides the
geometry behind), then only its *feature* edges (silhouette and sharp creases). The result looks
like a clean technical illustration rather than a shaded render, and it stays a tiny scalable SVG
that prints on A4 without bitmaps.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .config import (
    COLOR_ACTIVE_FILL,
    COLOR_ACTIVE_LINE,
    COLOR_ATTENTION,
    COLOR_GHOST,
    COLOR_INK,
    COLOR_PAPER,
    COLOR_PAPER_SHADE,
    CREASE_ANGLE_DEGREES,
    EXPLODE_FACTOR,
    MAX_SVG_FACES_PER_PART,
    MAX_SVG_TOTAL_FACES,
    SVG_HEIGHT,
    SVG_MARGIN,
    SVG_WIDTH,
)
from .models import CadPart


@dataclass
class SvgResult:
    svg: str
    triangles: int
    reduced: bool


def _basis(azimuth: float, elevation: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Camera basis: right, screen-up and the direction towards the viewer."""
    az = math.radians(azimuth)
    el = math.radians(max(-89.0, min(89.0, elevation)))
    direction = np.array(
        [math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)], dtype=float
    )
    up = np.array([0.0, 1.0, 0.0])
    right = np.cross(up, direction)
    if float(np.linalg.norm(right)) < 1e-6:
        right = np.array([1.0, 0.0, 0.0])
    right = right / float(np.linalg.norm(right))
    screen_up = np.cross(direction, right)
    screen_up = screen_up / float(np.linalg.norm(screen_up))
    return right, screen_up, direction


def _normalise_mesh(mesh):
    """Weld vertices and drop degenerate faces so edge adjacency is meaningful."""
    prepared = mesh.copy()
    prepared.merge_vertices()
    prepared.update_faces(prepared.nondegenerate_faces())
    try:
        prepared.fix_normals()
    except Exception:  # pragma: no cover - degenerate meshes
        pass
    return prepared


def _feature_edges(mesh, angle_degrees: float = CREASE_ANGLE_DEGREES) -> tuple[np.ndarray, np.ndarray]:
    """Feature mask plus the two faces of every edge.

    ``mask[i]`` says whether ``mesh.edges_sorted[i]`` is a silhouette/sharp edge; ``owners[i]``
    holds the adjacent face indices (-1 when the edge is on the boundary). The renderer draws a
    shared edge only once, with the nearer of its two faces, so hidden lines stay hidden.
    """
    edges = np.asarray(mesh.edges_sorted, dtype=np.int64)
    if len(edges) == 0:
        return np.zeros(0, dtype=bool), np.full((0, 2), -1, dtype=np.int64)
    normals = np.asarray(mesh.face_normals, dtype=float)

    keyed: dict[tuple[int, int], list[int]] = {}
    for index, (a, b) in enumerate(edges):
        keyed.setdefault((int(a), int(b)), []).append(index)

    threshold = math.cos(math.radians(angle_degrees))
    feature = np.zeros(len(edges), dtype=bool)
    owners = np.full((len(edges), 2), -1, dtype=np.int64)
    for _key, face_indices in keyed.items():
        first = face_indices[0]
        owners[face_indices[0], 0] = first // 3
        if len(face_indices) == 1:
            feature[face_indices] = True
            continue
        second = face_indices[1]
        owners[face_indices[1], 0] = second // 3
        owners[face_indices[0], 1] = second // 3
        owners[face_indices[1], 1] = first // 3
        if first >= len(normals) or second >= len(normals):
            continue
        dot = float(np.clip(np.dot(normals[first], normals[second]), -1.0, 1.0))
        if dot < threshold:
            feature[face_indices] = True
    return feature, owners


def _reduce_faces(mesh, budget: int):
    """Keeps the model within the SVG budget so a dense CAD mesh still yields a light diagram."""
    if len(mesh.faces) <= budget:
        return mesh, False
    try:
        simplified = mesh.simplify_quadric_decimation(face_count=budget)
    except Exception:  # pragma: no cover - optional backend
        simplified = None
    if simplified is not None and len(simplified.faces) > 0:
        return simplified, True
    areas = np.asarray(mesh.area_faces, dtype=float)
    keep = np.argsort(-areas)[:budget]
    keep.sort()
    return mesh.submesh([keep], append=True) if len(keep) else mesh, True


def _escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _arrow(x1: float, y1: float, x2: float, y2: float) -> str:
    """Thick blue installation arrow with a filled head."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1.0
    ux, uy = dx / length, dy / length
    head = 15.0
    base_x, base_y = x2 - ux * head, y2 - uy * head
    normal_x, normal_y = -uy * head * 0.42, ux * head * 0.42
    return (
        f'<g class="install-arrow" stroke="{COLOR_ACTIVE_LINE}" fill="{COLOR_ACTIVE_LINE}">'
        f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{base_x:.1f}" y2="{base_y:.1f}" '
        f'stroke-width="5" stroke-linecap="round"/>'
        f'<path d="M {x2:.1f} {y2:.1f} L {base_x + normal_x:.1f} {base_y + normal_y:.1f} '
        f'L {base_x - normal_x:.1f} {base_y - normal_y:.1f} Z" stroke="none"/>'
        "</g>"
    )


def _callout(x: float, y: float, text: str, width: float) -> str:
    label_width = min(width * 0.9, 7.4 * len(text) + 26)
    x0 = max(6.0, min(width - label_width - 6.0, x - label_width / 2))
    y0 = max(6.0, y - 58.0)
    return (
        f'<g class="attention" stroke="{COLOR_ATTENTION}" fill="{COLOR_ATTENTION}">'
        f'<circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="none" stroke-width="3" stroke-dasharray="5 4"/>'
        f'<path d="M {x:.1f} {y - 15:.1f} L {x0 + label_width / 2:.1f} {y0 + 26:.1f}" '
        f'stroke-width="1.6" fill="none" stroke-dasharray="4 3"/>'
        f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{label_width:.1f}" height="26" rx="13" '
        f'fill="#FFFFFF" stroke-width="2"/>'
        f'<text x="{x0 + 13:.1f}" y="{y0 + 17.5:.1f}" font-size="13" font-weight="700" '
        f'fill="{COLOR_ATTENTION}" stroke="none">{_escape(text)}</text>'
        "</g>"
    )


def render_assembly_svg(
    parts: list[CadPart],
    *,
    active_ids: list[str],
    installed_ids: list[str],
    azimuth: float,
    elevation: float,
    explode: float = 0.45,
    ghost_ids: list[str] | None = None,
    attention: str | None = None,
    caption: str | None = None,
    width: int = SVG_WIDTH,
    height: int = SVG_HEIGHT,
) -> SvgResult:
    """Renders one assembly state; the palette is exactly the three meaningful IKEA colours."""
    by_id = {part.id: part for part in parts}
    active = [by_id[part_id] for part_id in active_ids if part_id in by_id]
    installed = [by_id[part_id] for part_id in installed_ids if part_id in by_id]
    ghosts = [by_id[part_id] for part_id in (ghost_ids or []) if part_id in by_id]
    ghost_set = {part.id for part in ghosts}
    ghosts = [part for part in ghosts if part.id not in {item.id for item in active} | {item.id for item in installed}]

    if not active and not installed and not ghosts:
        active = list(parts)

    right, screen_up, view = _basis(azimuth, elevation)

    extent = max((part.diagonal for part in parts), default=1.0) or 1.0
    explode_distance = EXPLODE_FACTOR * extent * max(0.0, min(1.0, explode))

    reduced_any = False
    used_faces = 0
    prepared: list[dict] = []

    def prepare(part: CadPart, exploded: bool, ghost: bool) -> dict | None:
        nonlocal reduced_any, used_faces
        if part.mesh is None:
            return None
        budget = max(80, min(MAX_SVG_FACES_PER_PART, MAX_SVG_TOTAL_FACES - used_faces))
        if budget < 80:
            return None
        mesh, reduced = _reduce_faces(part.mesh, budget)
        mesh = _normalise_mesh(mesh)
        if len(mesh.faces) == 0:
            return None
        reduced_any = reduced_any or reduced
        used_faces += len(mesh.faces)
        vertices = np.asarray(mesh.vertices, dtype=float)
        offset = np.array(part.explosion_vector, dtype=float) * explode_distance if exploded else np.zeros(3)
        moved = vertices + offset
        feature, owners = _feature_edges(mesh)
        return {
            "part": part,
            "faces": np.asarray(mesh.faces, dtype=np.int64),
            "edges": np.asarray(mesh.edges_sorted, dtype=np.int64),
            "normals": np.asarray(mesh.face_normals, dtype=float),
            "feature": feature,
            "owners": owners,
            "x": moved @ right,
            "y": -(moved @ screen_up),
            "depth": moved @ view,
            "exploded": exploded,
            "ghost": ghost,
        }

    for part in installed:
        data = prepare(part, False, False)
        if data:
            prepared.append(data)
    for part in active:
        data = prepare(part, True, False)
        if data:
            prepared.append(data)
    for part in ghosts:
        if ghost_set:
            data = prepare(part, False, True)
            if data:
                prepared.append(data)

    if not prepared:
        for part in parts:
            data = prepare(part, False, False)
            if data:
                prepared.append(data)

    if not prepared:
        return SvgResult(
            svg=(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" '
                f'aria-label="Пустая схема"><rect width="{width}" height="{height}" fill="{COLOR_PAPER}"/>'
                f'<text x="{width / 2}" y="{height / 2}" text-anchor="middle" fill="{COLOR_INK}" '
                f'font-size="16">Нет геометрии для схемы</text></svg>'
            ),
            triangles=0,
            reduced=False,
        )

    all_x = np.concatenate([data["x"] for data in prepared])
    all_y = np.concatenate([data["y"] for data in prepared])
    min_x, max_x = float(all_x.min()), float(all_x.max())
    min_y, max_y = float(all_y.min()), float(all_y.max())
    span_x, span_y = max(1e-6, max_x - min_x), max(1e-6, max_y - min_y)
    usable_w, usable_h = width - SVG_MARGIN * 2, height - SVG_MARGIN * 2
    scale = min(usable_w / span_x, usable_h / span_y)
    offset_x = SVG_MARGIN + (usable_w - span_x * scale) / 2 - min_x * scale
    offset_y = SVG_MARGIN + (usable_h - span_y * scale) / 2 + max_y * scale

    def to_screen(points_x: np.ndarray, points_y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return points_x * scale + offset_x, -points_y * scale + offset_y

    # Installed parts alternate between paper white and a light grey, so neighbours read apart.
    installed_fill: dict[str, str] = {}
    for index, part in enumerate(installed):
        installed_fill[part.id] = COLOR_PAPER if index % 2 == 0 else COLOR_PAPER_SHADE

    # Backface culling halves the element count without changing the silhouette.
    triangles: list[tuple[float, int, int]] = []
    for data_index, data in enumerate(prepared):
        face_vertices = data["faces"]
        data["face_depth"] = np.mean(data["depth"][face_vertices], axis=1)
        data["visible"] = (data["normals"] @ view) > 0.0
        for face_index in range(len(face_vertices)):
            if not bool(data["visible"][face_index]):
                continue
            triangles.append((float(data["face_depth"][face_index]), data_index, face_index))
    triangles.sort(key=lambda item: item[0])

    body: list[str] = []
    for _depth, data_index, face_index in triangles:
        data = prepared[data_index]
        part: CadPart = data["part"]
        face = data["faces"][face_index]
        xs, ys = to_screen(data["x"][face], data["y"][face])
        if data["ghost"]:
            fill, stroke, stroke_width, dashed = "none", COLOR_GHOST, 1.0, True
        elif data["exploded"]:
            fill, stroke, stroke_width, dashed = COLOR_ACTIVE_FILL, COLOR_ACTIVE_LINE, 1.9, False
        else:
            fill = installed_fill.get(part.id, COLOR_PAPER)
            stroke, stroke_width, dashed = COLOR_INK, 1.3, False
        points = " ".join(f"{x:.1f},{y:.1f}" for x, y in zip(xs, ys))
        dash_attr = ' stroke-dasharray="6 5"' if dashed else ""
        body.append(f'<polygon points="{points}" fill="{fill}" stroke="{fill}" stroke-width="0.7"/>')
        for local_edge in range(3):
            mask_index = face_index * 3 + local_edge
            if mask_index >= len(data["feature"]) or not bool(data["feature"][mask_index]):
                continue
            owner_row = data["owners"][mask_index]
            neighbour = int(owner_row[1]) if int(owner_row[1]) != face_index else int(owner_row[0])
            # A shared edge is drawn once, by its nearer face, so farther geometry cannot overpaint it.
            if neighbour >= 0 and float(data["face_depth"][neighbour]) > float(data["face_depth"][face_index]):
                continue
            a = int(data["edges"][mask_index][0])
            b = int(data["edges"][mask_index][1])
            x1, y1 = to_screen(data["x"][[a]], data["y"][[a]])
            x2, y2 = to_screen(data["x"][[b]], data["y"][[b]])
            body.append(
                f'<line x1="{x1[0]:.1f}" y1="{y1[0]:.1f}" x2="{x2[0]:.1f}" y2="{y2[0]:.1f}" '
                f'stroke="{stroke}" stroke-width="{stroke_width}" stroke-linecap="round"{dash_attr}/>'
            )

    overlays: list[str] = []
    exploded_data = [data for data in prepared if data["exploded"]]
    if exploded_data:
        centers = np.array(
            [np.asarray(data["part"].centroid, dtype=float) for data in exploded_data], dtype=float
        )
        with_offset = np.array(
            [np.asarray(data["part"].centroid, dtype=float) + np.array(data["part"].explosion_vector, dtype=float) * explode_distance for data in exploded_data],
            dtype=float,
        )
        vector = np.asarray(exploded_data[0]["part"].explosion_vector, dtype=float)
        installed_center = centers.mean(axis=0)
        exploded_center = with_offset.mean(axis=0)

        axis_start = installed_center - vector * explode_distance * 0.25
        axis_end = exploded_center + vector * explode_distance * 0.3
        ax1, ay1 = to_screen(np.array([axis_start @ right]), np.array([-(axis_start @ screen_up)]))
        ax2, ay2 = to_screen(np.array([axis_end @ right]), np.array([-(axis_end @ screen_up)]))
        overlays.append(
            f'<line x1="{ax1[0]:.1f}" y1="{ay1[0]:.1f}" x2="{ax2[0]:.1f}" y2="{ay2[0]:.1f}" '
            f'stroke="{COLOR_ACTIVE_LINE}" stroke-width="1.4" stroke-dasharray="7 6" opacity="0.7"/>'
        )
        from_x, from_y = to_screen(
            np.array([exploded_center @ right]), np.array([-(exploded_center @ screen_up)])
        )
        to_x, to_y = to_screen(
            np.array([installed_center @ right]), np.array([-(installed_center @ screen_up)])
        )
        overlays.append(_arrow(float(from_x[0]), float(from_y[0]), float(to_x[0]), float(to_y[0])))
        if attention:
            overlays.append(_callout(float(from_x[0]), float(from_y[0]), attention, width))

    label = caption or "Схема сборки"
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" aria-label="{_escape(label)}" '
        f'data-style="ikea-2.0" data-azimuth="{azimuth:.0f}" data-elevation="{elevation:.0f}">'
        f"<title>{_escape(label)}</title>"
        "<desc>Установленные детали — белые, активные детали шага — синие, внимание — красная выноска.</desc>"
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="{COLOR_PAPER}"/>'
        f'<g class="assembly" shape-rendering="geometricPrecision">'
        + "".join(body)
        + '</g><g class="overlay">'
        + "".join(overlays)
        + "</g></svg>"
    )
    return SvgResult(svg=svg, triangles=used_faces, reduced=reduced_any)
