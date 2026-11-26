"""Assembly sequencing by "reverse disassembly" and part classification.

The algorithm removes parts from the outside in, then inverts the removal order: the base plate
stays in the hand the longest, so it becomes step 1 of the instruction, while screws that fall out
first become the last step. Identical fasteners of one node are merged into a single step.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .config import CONTACT_TOLERANCE_MM, FASTENER_VOLUME_SHARE
from .models import AssemblyStep, CadPart, Vector3

# Removal candidate order: +Y (up) first, then the rest of the axes.
DIRECTIONS: tuple[Vector3, ...] = (
    (0.0, 1.0, 0.0),
    (0.0, -1.0, 0.0),
    (1.0, 0.0, 0.0),
    (-1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0),
    (0.0, 0.0, -1.0),
)

FASTENER_WORDS = re.compile(
    r"(болт|винт|гайк|шайб|шайб|шпильк|саморез|закл[её]пк|штифт|"
    r"bolt|screw|nut|washer|stud|rivet|pin\b|"
    r"\bdin\b|\biso\b|\bгост\b|\bgost\b)",
    re.IGNORECASE,
)

COVER_HINTS = re.compile(r"(крышк|флан[её]ц|планк|панел|lid|cover|flange|plate|panel)", re.IGNORECASE)


@dataclass
class SequenceResult:
    steps: list[AssemblyStep]
    warnings: list[str]
    disassembly: list[str]


def _aabb(part: CadPart, tolerance: float) -> tuple[Vector3, Vector3]:
    return (
        (part.bbox_min[0] - tolerance, part.bbox_min[1] - tolerance, part.bbox_min[2] - tolerance),
        (part.bbox_max[0] + tolerance, part.bbox_max[1] + tolerance, part.bbox_max[2] + tolerance),
    )


def _overlaps(a: CadPart, b: CadPart, tolerance: float = CONTACT_TOLERANCE_MM) -> bool:
    a_min, a_max = _aabb(a, tolerance)
    b_min, b_max = _aabb(b, tolerance)
    return all(a_min[i] <= b_max[i] and b_min[i] <= a_max[i] for i in range(3))


def _touching(a: CadPart, b: CadPart, tolerance: float = CONTACT_TOLERANCE_MM * 2.5) -> bool:
    """True when two parts are in contact or overlap: used for the assembly-order sanity check."""
    a_min, a_max = _aabb(a, tolerance)
    b_min, b_max = _aabb(b, tolerance)
    return all(a_min[i] <= b_max[i] and b_min[i] <= a_max[i] for i in range(3))


def _extent_along(part: CadPart, axis: Vector3) -> float:
    size = part.size
    return sum(abs(axis[i]) * size[i] for i in range(3))


def _distance_from_center(part: CadPart) -> float:
    center = part.center
    return math.sqrt(center[0] ** 2 + center[1] ** 2 + center[2] ** 2)


def detached_direction(part: CadPart, others: list[CadPart]) -> tuple[Vector3, int]:
    """Picks the axis with the fewest collisions when the part is pulled out of the assembly."""
    best: tuple[Vector3, int] | None = None
    for index, direction in enumerate(DIRECTIONS):
        distance = _extent_along(part, direction) + CONTACT_TOLERANCE_MM * 4
        moved = CadPart(
            id=part.id,
            name=part.name,
            node_name=part.node_name,
            bbox_min=tuple(part.bbox_min[i] + direction[i] * distance for i in range(3)),  # type: ignore[arg-type]
            bbox_max=tuple(part.bbox_max[i] + direction[i] * distance for i in range(3)),  # type: ignore[arg-type]
        )
        collisions = sum(1 for other in others if _overlaps(moved, other))
        candidate = (direction, collisions)
        if best is None or collisions < best[1]:
            best = candidate
            if collisions == 0:
                # Keep the first free axis in DIRECTIONS order for determinism.
                continue
    assert best is not None
    return best


def classify_parts(parts: list[CadPart]) -> list[str]:
    """Sets ``role`` on every part; returns human-readable warnings."""
    warnings: list[str] = []
    if not parts:
        return warnings

    total_volume = sum(part.volume_mm3 for part in parts) or 1.0
    assembly_diagonal = max((part.diagonal for part in parts), default=1.0) or 1.0
    for part in parts:
        if FASTENER_WORDS.search(part.name or ""):
            part.role = "fastener"
            continue
        size = sorted((value for value in part.size if value > 1e-6))
        if len(size) < 1 or part.volume_mm3 <= 1.0:
            part.role = "part"
            continue
        slenderness = size[-1] / size[0]
        share = part.volume_mm3 / total_volume
        small = share < FASTENER_VOLUME_SHARE / 2 and size[-1] <= 0.18 * assembly_diagonal
        generic_name = not any(char.isalpha() for char in (part.name or "").strip()[:1])
        looks_like_hardware = generic_name or re.search(r"\d", part.name or "") is not None
        if small and slenderness >= 2.6 and looks_like_hardware:
            part.role = "fastener"
            continue
        part.role = "part"

    bodies = [part for part in parts if part.role != "fastener"]
    if not bodies:
        warnings.append("В сборке только крепёж: базовая деталь назначена по объёму.")
        largest = max(parts, key=lambda item: item.volume_mm3)
        largest.role = "base"
        return warnings

    # Base: the heaviest body that sits closest to the assembly centre.
    max_volume = max(part.volume_mm3 for part in bodies) or 1.0
    max_distance = max((_distance_from_center(part) for part in bodies), default=1.0) or 1.0

    def base_score(part: CadPart) -> float:
        centrality = 1.0 - (_distance_from_center(part) / max_distance)
        return (part.volume_mm3 / max_volume) * (0.55 + 0.45 * centrality)

    base = max(bodies, key=base_score)
    base.role = "base"
    if len(bodies) > 1 and base.volume_mm3 < 0.25 * max_volume:
        warnings.append("Базовая деталь выбрана неуверенно: объёмы деталей близки.")
    return warnings


def _is_cover(part: CadPart, base: CadPart | None) -> bool:
    if part.role != "part":
        return False
    if COVER_HINTS.search(part.name or ""):
        return True
    if base is None:
        return False
    size = sorted(part.size)
    flat = size[0] * 2.5 < size[2]
    above = part.center[1] > base.center[1] + base.size[1] * 0.15
    return flat and above


def _sentence(value: str) -> str:
    return value[:1].lower() + value[1:] if value else value


def _step_title(part: CadPart, count: int, kind: str, notation: str | None) -> str:
    from .names import accusative, fastener_verb, has_notation, pluralize_fastener

    raw = part.name.strip()
    name = raw[:1].lower() + raw[1:] if raw else raw
    suffix = f" {notation}" if notation and not has_notation(raw, notation) else ""
    if kind == "base":
        return f"Уложи {_sentence(accusative(raw))} базой вверх"
    if kind == "fastener":
        verb = fastener_verb(name)
        if count > 1:
            plural = pluralize_fastener(raw, count)
            return f"{verb} {count} {_sentence(plural)}{suffix}"
        return f"{verb} {name}{suffix}"
    return f"Установи {_sentence(accusative(raw))}"


def _view_for(role: str) -> tuple[float, float]:
    if role == "fastener":
        return -30.0, 34.0
    if role == "base":
        return 35.0, 26.0
    return -38.0, 30.0


def sequence_assembly(parts: list[CadPart]) -> SequenceResult:
    """Builds the assembly order and per-step explosion vectors."""
    warnings = classify_parts(parts)
    if not parts:
        return SequenceResult(steps=[], warnings=warnings + ["Сборка пуста."], disassembly=[])

    base = next((part for part in parts if part.role == "base"), None)
    remaining = list(parts)
    removal: list[tuple[CadPart, Vector3, int]] = []

    while remaining:
        scored: list[tuple[tuple[int, int, float, float], CadPart, Vector3, int]] = []
        for part in remaining:
            others = [item for item in remaining if item.id != part.id]
            direction, collisions = detached_direction(part, others)

            def role_rank(candidate: CadPart) -> int:
                if candidate.role == "fastener":
                    return 0
                if candidate is base:
                    return 2
                return 1

            key = (1 if collisions else 0, role_rank(part), -_distance_from_center(part), part.volume_mm3)
            scored.append((key, part, direction, collisions))
        scored.sort(key=lambda item: item[0])
        key, part, direction, collisions = scored[0]
        if collisions:
            warnings.append(
                f"«{part.name}» перекрыта соседями: направление вынимания выбрано приближённо."
            )
        part.explosion_vector = direction
        removal.append((part, direction, collisions))
        remaining = [item for item in remaining if item.id != part.id]

    insertion = list(reversed(removal))

    steps: list[AssemblyStep] = []
    grouped: list[list[tuple[CadPart, Vector3, int]]] = []
    for item in insertion:
        part = item[0]
        if (
            part.role == "fastener"
            and grouped
            and grouped[-1][0][0].role == "fastener"
            and grouped[-1][0][0].group_key == part.group_key
        ):
            grouped[-1].append(item)
        else:
            grouped.append([item])

    for number, group in enumerate(grouped, start=1):
        part = group[0][0]
        vector = group[0][1]
        role = "fastener" if part.role == "fastener" else part.role
        kind = "base" if part.role == "base" else ("fastener" if role == "fastener" else ("cover" if _is_cover(part, base) else "part"))
        azimuth, elevation = _view_for(role)
        notation = part.notation if kind == "fastener" else None
        attention = None
        if kind == "fastener" and len(group) > 1:
            if re.search(r"шайб|washer", part.name, re.IGNORECASE):
                attention = "Шайба ставится под головку каждого болта — иначе крышка продавится."
            elif re.search(r"гайк|nut", part.name, re.IGNORECASE):
                attention = "Затягивайте крест-накрест: сначала наживите все гайки, потом тяните по диагонали."
            else:
                attention = "Затягивайте крест-накрест: сначала наживите все, потом тяните по диагонали."
        elif kind == "cover" and vector[1] < 0:
            attention = f"Проверьте ориентацию «{part.name}»: она устанавливается снизу."
        elif kind == "part" and vector[1] < 0:
            attention = f"«{part.name}» заходит снизу — не переверните узел."

        steps.append(
            AssemblyStep(
                number=number,
                kind=kind,  # type: ignore[arg-type]
                title=_step_title(part, len(group), kind, notation),
                part_ids=[entry[0].id for entry in group],
                explosion_vector=vector,
                azimuth=azimuth,
                elevation=elevation,
                fastener_key=part.group_key if kind == "fastener" else None,
                notation=notation,
                attention=attention,
            )
        )

    if len(steps) == 1:
        warnings.append("В модели одна деталь: последовательность сборки не требуется.")
    return SequenceResult(
        steps=steps,
        warnings=warnings,
        disassembly=[entry[0].id for entry in removal],
    )


def assembly_order_is_consistent(parts: list[CadPart], steps: list[AssemblyStep]) -> bool:
    """Every part except the base must touch something installed before it — or the base itself."""
    installed: list[CadPart] = []
    by_id = {part.id: part for part in parts}
    for step in steps:
        for part_id in step.part_ids:
            part = by_id.get(part_id)
            if part is None:
                return False
            if installed and not any(_touching(part, other) for other in installed):
                return False
            installed.append(part)
    return True
