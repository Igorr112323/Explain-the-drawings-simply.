"""Таблица позиций (спецификация на поле чертежа) и подписи видов.

Это единственное место сервиса, где разрозненные строки OCR собираются в строки таблицы:
«ПОЗИЦИЯ / ОБОЗНАЧЕНИЕ / НАИМЕНОВАНИЕ / КОЛ-ВО» и подписи видов («Спереди», «Сбоку»,
«Сверху», «Изометрия», «Разрез А-А»). Никаких объяснений здесь нет: сервис только сообщает,
что увидел, а шаги сборки из этих строк строит TypeScript-билдер.

Геометрия возвращается в пикселях листа — вызывающая сторона сама переводит её в проценты.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

from .extractor import TextLine
from .layout import Box

# --- шапка таблицы позиций ---------------------------------------------------------------

_HEADER_KINDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("position", ("позиция", "позиции", "поз", "поз.", "no", "№")),
    ("designation", ("обозначение", "обозначения", "обозн", "обозн.", "об.", "designation")),
    ("name", ("наименование", "наименования", "название", "описание", "наимен", "description")),
    ("quantity", ("количество", "кол-во", "кол.", "кол", "к-во", "шт", "шт.", "qty")),
)

# Если шапку распознали одним куском (OCR склеил колонки), режем её по этим долям ширины.
_FALLBACK_COLUMNS: tuple[tuple[str, float, float], ...] = (
    ("position", 0.0, 0.12),
    ("designation", 0.12, 0.36),
    ("name", 0.36, 0.88),
    ("quantity", 0.88, 1.0),
)

MAX_BOM_ROWS = 20
# Обозначения («АБВ.301.12», «ГОСТ 7798-70») держатся на точках и дефисах: их не убираем,
# чистим только кавычки, рамки таблицы и мусор OCR.
_NOISE = re.compile(r"[«»\"'`|\\\[\]~^*_]+")


@dataclass(frozen=True)
class BomRow:
    """Строка таблицы позиций: что взять, сколько и под каким номером."""

    position: int | None
    designation: str | None
    name: str
    quantity: int | None
    box: Box


@dataclass(frozen=True)
class SheetView:
    """Подпись вида на листе: по ним строятся шаги «посмотрите на вид …»."""

    name: str
    box: Box


def _union(boxes: list[Box]) -> Box:
    x = min(box.x for box in boxes)
    y = min(box.y for box in boxes)
    x2 = max(box.x2 for box in boxes)
    y2 = max(box.y2 for box in boxes)
    return Box(x, y, max(1, x2 - x), max(1, y2 - y))


def _clean(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    stripped = re.sub(r"\s+", " ", _NOISE.sub(" ", collapsed))
    return stripped.strip(" .,;:()—–-")


def _cell_kind(text: str) -> str | None:
    lowered = re.sub(r"\s+", " ", text).strip().lower()
    if not lowered:
        return None
    for kind, words in _HEADER_KINDS:
        if lowered in words:
            return kind
    for kind, words in _HEADER_KINDS:
        if any(len(word) > 3 and lowered.startswith(word) for word in words):
            return kind
    return None


def group_rows(lines: list[TextLine]) -> list[list[TextLine]]:
    """Складывает строки текста в визуальные строки листа: по вертикальному центру."""
    ordered = sorted(lines, key=lambda line: (line.center[1], line.box.x))
    heights = [line.box.h for line in ordered if line.box.h > 0]
    tolerance = float(np.median(heights)) * 0.6 if heights else 8.0
    rows: list[list[TextLine]] = []
    centers: list[float] = []
    for line in ordered:
        if rows and abs(line.center[1] - centers[-1]) <= tolerance:
            rows[-1].append(line)
            centers[-1] = float(np.mean([item.center[1] for item in rows[-1]]))
        else:
            rows.append([line])
            centers.append(line.center[1])
    for row in rows:
        row.sort(key=lambda line: line.box.x)
    return rows


def split_cells(row: list[TextLine]) -> list[tuple[str, Box]]:
    """Делит визуальную строку на ячейки по горизонтальным пробелам."""
    if not row:
        return []
    heights = [line.box.h for line in row if line.box.h > 0]
    # Пробел внутри ячейки («Ручка жаровни») заметно меньше зазора между колонками.
    gap_limit = max(4.0, float(np.median(heights)) * 0.4) if heights else 6.0
    cells: list[tuple[str, Box]] = []
    text = ""
    box: Box | None = None
    for line in row:
        if box is not None and line.box.x - box.x2 > gap_limit:
            cells.append((text, box))
            text = ""
            box = None
        text = f"{text} {line.text}".strip() if text else line.text
        box = line.box if box is None else _union([box, line.box])
    if box is not None and text:
        cells.append((text, box))
    return cells


def _columns(header_cells: list[tuple[str, Box]], header_box: Box) -> dict[str, tuple[float, float]]:
    """Колонки таблицы: границы по распознанным словам шапки, иначе — по долям ширины."""
    columns: dict[str, tuple[float, float]] = {}
    for text, box in header_cells:
        kind = _cell_kind(text)
        if kind and kind not in columns:
            columns[kind] = (float(box.x), float(box.x2))

    if len(columns) < 3:
        width = max(1.0, float(header_box.w))
        for kind, start, end in _FALLBACK_COLUMNS:
            columns.setdefault(kind, (header_box.x + width * start, header_box.x + width * end))
    return columns


def _kind_for_box(box: Box, columns: dict[str, tuple[float, float]]) -> str | None:
    best: tuple[float, str] | None = None
    for kind, (start, end) in columns.items():
        overlap = min(end, float(box.x2)) - max(start, float(box.x))
        if overlap <= 0:
            continue
        if best is None or overlap > best[0]:
            best = (overlap, kind)
    if best is not None:
        return best[1]
    # Ячейка уже колонки: определяем по центру.
    center = box.x + box.w / 2.0
    nearest = min(columns.items(), key=lambda item: abs((item[1][0] + item[1][1]) / 2.0 - center), default=None)
    return nearest[0] if nearest else None


def _as_int(text: str | None, limit: int = 9999) -> int | None:
    if not text:
        return None
    digits = re.search(r"\d{1,4}", text.replace(" ", ""))
    if not digits:
        return None
    value = int(digits.group(0))
    return value if 0 < value <= limit else None


def _row_from_cells(cells: list[tuple[str, Box]], columns: dict[str, tuple[float, float]]) -> BomRow | None:
    values: dict[str, str] = {}
    for text, box in cells:
        kind = _kind_for_box(box, columns)
        if kind is None:
            continue
        cleaned = _clean(text)
        if cleaned:
            values[kind] = f"{values[kind]} {cleaned}".strip() if kind in values else cleaned

    name = values.get("name") or ""
    designation = values.get("designation") or None
    if len(name) < 3 and designation and re.search(r"[А-Яа-яЁёA-Za-z]{3}", designation):
        name, designation = designation, None
    if len(name) < 3:
        return None

    position = _as_int(values.get("position"))
    quantity = _as_int(values.get("quantity"), limit=999)
    if position is None and quantity is None and designation is None:
        return None

    cell_boxes = [box for _, box in cells]
    return BomRow(
        position=position,
        designation=designation,
        name=name[:120],
        quantity=quantity,
        box=_union(cell_boxes),
    )


# «5 Ручка жаровни 2» — шапка не распознана, но строка таблицы читается по структуре.
_FLAT_ROW = re.compile(r"^(\d{1,3})\s+(.{3,120}?)\s+(\d{1,3})$")


def extract_bom_rows(lines: list[TextLine], limit: int = MAX_BOM_ROWS) -> list[BomRow]:
    """Достаёт строки таблицы позиций. Возвращает [] если таблицы на листе нет."""
    if len(lines) < 4:
        return []

    rows = group_rows(lines)
    cells_per_row = [split_cells(row) for row in rows]
    heights = [line.box.h for line in lines if line.box.h > 0]
    row_height = float(np.median(heights)) if heights else 8.0

    header_index: int | None = None
    header_box: Box | None = None
    columns: dict[str, tuple[float, float]] = {}
    for index, cells in enumerate(cells_per_row):
        kinds = {kind for kind in (_cell_kind(text) for text, _ in cells) if kind}
        joined = " ".join(text for text, _ in cells).lower()
        if len(kinds) >= 3 or (len(kinds) >= 2 and sum(joined.count(word) for word in ("поз", "обозн", "наимен", "кол")) >= 3):
            header_index = index
            header_box = _union([box for _, box in cells])
            columns = _columns(cells, header_box)
            break

    if header_index is not None and header_box is not None:
        found: list[BomRow] = []
        last_y = header_box.y2
        failures = 0
        for cells in cells_per_row[header_index + 1 :]:
            if not cells:
                continue
            row_box = _union([box for _, box in cells])
            # Между шапкой и первой строкой обычно шире просвет, чем между строками.
            max_gap = row_height * 8.0 if not found else row_height * 4.0
            if row_box.y - last_y > max_gap or len(found) >= limit:
                break
            parsed = _row_from_cells(cells, columns)
            if parsed is None:
                failures += 1
                if failures >= 2 and found:
                    break
                continue
            failures = 0
            last_y = row_box.y2
            found.append(parsed)
        if found:
            return found

    # Запасной путь: шапка не читается, ищем строки «позиция … количество».
    flat: list[BomRow] = []
    for cells in cells_per_row:
        if not cells:
            continue
        joined = _clean(" ".join(text for text, _ in cells))
        match = _FLAT_ROW.match(joined)
        if not match:
            continue
        name = _clean(match.group(2))
        if len(name) < 3:
            continue
        flat.append(
            BomRow(
                position=int(match.group(1)),
                designation=None,
                name=name[:120],
                quantity=int(match.group(3)),
                box=_union([box for _, box in cells]),
            )
        )
        if len(flat) >= limit:
            break
    return flat


# --- подписи видов ------------------------------------------------------------------------

_VIEW_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bвид\s+спереди\b|\bглавный\s+вид\b|\bспереди\b", re.IGNORECASE), "Спереди"),
    (re.compile(r"\bвид\s+сбоку\b|\bсбоку\b", re.IGNORECASE), "Сбоку"),
    (re.compile(r"\bвид\s+сверху\b|\bсверху\b", re.IGNORECASE), "Сверху"),
    (re.compile(r"\bвид\s+снизу\b|\bснизу\b", re.IGNORECASE), "Снизу"),
    (re.compile(r"\bвид\s+сзади\b|\bсзади\b", re.IGNORECASE), "Сзади"),
    (re.compile(r"\bизометр\w*\b|\bаксонометр\w*\b", re.IGNORECASE), "Изометрия"),
    (re.compile(r"\bразрез\s+([А-ЯЁA-Z])\s*[-–]\s*([А-ЯЁA-Z])", re.IGNORECASE), "Разрез"),
    (re.compile(r"\bсечение\s+([А-ЯЁA-Z])\s*[-–]", re.IGNORECASE), "Сечение"),
)

VIEW_NAMES = tuple(name for _, name in _VIEW_PATTERNS)


def extract_views(lines: list[TextLine]) -> list[SheetView]:
    """Подписи видов и разрезов: «Спереди», «Сбоку», «Сверху», «Изометрия», «Разрез А-А»."""
    views: list[SheetView] = []
    heights = [line.box.h for line in lines if line.box.h > 0]
    # Два распознавания одной подписи стоят рядом: считаем их одной подписью в пределах строки.
    near = max(16.0, (float(np.median(heights)) if heights else 12.0) * 3.0)
    for line in sorted(lines, key=lambda item: (item.center[1], item.box.x)):
        text = re.sub(r"\s+", " ", line.text).strip()
        if not text or len(text) > 40:
            continue
        for pattern, name in _VIEW_PATTERNS:
            match = pattern.search(text)
            if not match:
                continue
            label = name
            if name in {"Разрез", "Сечение"}:
                letters = "".join(group for group in match.groups() if group)
                if len(letters) >= 2:
                    label = f"{name} {letters[0].upper()}-{letters[1].upper()}"
            duplicate = any(
                view.name == label
                and abs(view.box.x - line.box.x) <= near
                and abs(view.box.y - line.box.y) <= near
                for view in views
            )
            if not duplicate:
                views.append(SheetView(name=label, box=line.box))
            break
    return views
