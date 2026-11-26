"""Import pipeline: load → classify/sequence → SVG per step → session payload."""

from __future__ import annotations

import base64
from typing import Any

from .ikea_svg import render_assembly_svg
from .loader import CadLoadError, load_model
from .models import CadPart
from .sequencer import sequence_assembly
from .session import CadSession, store


def part_payload(part: CadPart) -> dict[str, Any]:
    return {
        "id": part.id,
        "name": part.name,
        "nodeName": part.node_name,
        "role": part.role,
        "bbox": {
            "min": [round(value, 3) for value in part.bbox_min],
            "max": [round(value, 3) for value in part.bbox_max],
            "size": [round(value, 3) for value in part.size],
        },
        "volumeMm3": round(part.volume_mm3, 2),
        "centroid": [round(value, 3) for value in part.centroid],
        "triangleCount": part.triangle_count,
        "explosionVector": [float(value) for value in part.explosion_vector],
        "groupKey": part.group_key,
        "notation": part.notation,
    }


def render_step_svg(
    parts: list[CadPart],
    *,
    active_ids: list[str],
    installed_ids: list[str],
    azimuth: float,
    elevation: float,
    attention: str | None = None,
    caption: str | None = None,
    explode: float = 0.45,
) -> tuple[str, int, bool]:
    result = render_assembly_svg(
        parts,
        active_ids=active_ids,
        installed_ids=installed_ids,
        azimuth=azimuth,
        elevation=elevation,
        explode=explode,
        attention=attention,
        caption=caption,
    )
    return result.svg, result.triangles, result.reduced


def import_cad(filename: str, data: bytes) -> CadSession:
    """Loads a file, builds the assembly order and stores the session for later re-rendering."""
    loaded = load_model(filename, data)
    parts = loaded.parts
    sequence = sequence_assembly(parts)
    warnings = list(loaded.warnings) + list(sequence.warnings)

    installed: list[str] = []
    svg_triangles = 0
    reduced = False
    for step in sequence.steps:
        svg, triangles, step_reduced = render_step_svg(
            parts,
            active_ids=step.part_ids,
            installed_ids=list(installed),
            azimuth=step.azimuth,
            elevation=step.elevation,
            attention=step.attention,
            caption=f"Шаг {step.number}. {step.title}",
        )
        step.svg = svg
        step.worker_text = step.title
        installed.extend(step.part_ids)
        svg_triangles += triangles
        reduced = reduced or step_reduced

    if reduced:
        warnings.append("Схемы упрощены до бюджета граней — на печати это не видно.")

    overview_svg, _overview_triangles, _ = render_step_svg(
        parts,
        active_ids=[],
        installed_ids=[part.id for part in parts],
        azimuth=35.0,
        elevation=26.0,
        caption=loaded.assembly_name,
    )

    glb_data_url = "data:model/gltf-binary;base64," + base64.b64encode(loaded.glb_bytes).decode("ascii")
    session = store.create(
        filename=filename,
        parts=parts,
        steps=sequence.steps,
        glb_data_url=glb_data_url,
        assembly_name=loaded.assembly_name,
        size_mm=loaded.size_mm,
        mass_kg=loaded.mass_kg,
        source_format=loaded.source_format,
        unit_scale=loaded.unit_scale,
        warnings=warnings,
    )
    # Overview diagram of the fully assembled unit (used by «Перед началом работы»).
    session.overview_svg = overview_svg
    return session


def session_payload(session: CadSession) -> dict[str, Any]:
    parts = session.parts
    fasteners = [part for part in parts if part.role == "fastener"]
    triangles = sum(part.triangle_count for part in parts)
    return {
        "schemaVersion": "1.0",
        "sessionId": session.id,
        "assembly": {
            "name": session.assembly_name,
            "filename": session.filename,
            "sourceFormat": session.source_format,
            "unitScale": session.unit_scale,
            "sizeMm": [round(value, 2) for value in session.size_mm],
            "massKg": round(session.mass_kg, 3),
        },
        "parts": [part_payload(part) for part in parts],
        "steps": [
            {
                "number": step.number,
                "kind": step.kind,
                "title": step.title,
                "workerText": step.worker_text,
                "partIds": list(step.part_ids),
                "count": step.count,
                "explosionVector": [float(value) for value in step.explosion_vector],
                "azimuth": step.azimuth,
                "elevation": step.elevation,
                "fastenerKey": step.fastener_key,
                "notation": step.notation,
                "attention": step.attention,
                "svg": step.svg,
            }
            for step in session.steps
        ],
        "overviewSvg": session.overview_svg,
        "glbDataUrl": session.glb_data_url,
        "warnings": list(session.warnings),
        "stats": {
            "parts": len(parts),
            "fasteners": len(fasteners),
            "steps": len(session.steps),
            "triangles": triangles,
        },
    }


def rerender(
    session_id: str,
    *,
    azimuth: float,
    elevation: float,
    active_ids: list[str] | None = None,
    installed_ids: list[str] | None = None,
    ghost_ids: list[str] | None = None,
    explode: float = 0.45,
    attention: str | None = None,
    caption: str | None = None,
) -> tuple[str, int]:
    session = store.get(session_id)
    if session is None:
        raise CadLoadError(
            "Сессия модели не найдена: импортируйте файл заново (сервис хранит модели час).",
            code="session_not_found",
            status=404,
        )
    known = {part.id for part in session.parts}
    active = [part_id for part_id in (active_ids or []) if part_id in known]
    installed = [part_id for part_id in (installed_ids or []) if part_id in known]
    ghost = [part_id for part_id in (ghost_ids or []) if part_id in known]
    result = render_assembly_svg(
        session.parts,
        active_ids=active,
        installed_ids=installed,
        ghost_ids=ghost,
        azimuth=azimuth,
        elevation=elevation,
        explode=explode,
        attention=attention,
        caption=caption,
    )
    return result.svg, result.triangles
