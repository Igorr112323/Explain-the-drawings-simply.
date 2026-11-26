"""Таблица позиций и подписи видов: строки OCR → понятные данные для шагов сборки."""

from __future__ import annotations

import numpy as np

from app.extractor import TextLine
from app.layout import Box, Layout
from app.tables import extract_bom_rows, extract_views, group_rows, split_cells


def line(text: str, x: int, y: int, w: int | None = None, h: int = 18) -> TextLine:
    width = w if w is not None else max(12, len(text) * 10)
    return TextLine(text=text, box=Box(x, y, width, h), confidence=0.86, source="ocr")


def bom_sheet_lines() -> list[TextLine]:
    """Шапка «ПОЗИЦИЯ ОБОЗНАЧЕНИЕ НАИМЕНОВАНИЕ КОЛ-ВО» и три строки под ней."""
    lines = [
        line("ПОЗИЦИЯ", 40, 600, 90),
        line("ОБОЗНАЧЕНИЕ", 140, 600, 150),
        line("НАИМЕНОВАНИЕ", 300, 600, 190),
        line("КОЛ-ВО", 500, 600, 70),
        line("5", 40, 640, 12),
        line("АБВ.301.12", 140, 640, 110),
        line("Ручка", 300, 640, 55),
        line("жаровни", 360, 640, 70),
        line("2", 500, 640, 12),
        line("6", 40, 680, 12),
        line("АБВ.301.13", 140, 680, 110),
        line("Кронштейн", 300, 680, 85),
        line("1", 500, 680, 12),
        line("7", 40, 720, 12),
        line("ГОСТ 7798-70", 140, 720, 130),
        line("Болт М8", 300, 720, 75),
        line("4", 500, 720, 12),
    ]
    return lines


def test_group_rows_merges_words_on_one_line() -> None:
    rows = group_rows(bom_sheet_lines())
    assert len(rows) == 4
    assert [item.text for item in rows[0]] == ["ПОЗИЦИЯ", "ОБОЗНАЧЕНИЕ", "НАИМЕНОВАНИЕ", "КОЛ-ВО"]
    assert [item.text for item in rows[1]] == ["5", "АБВ.301.12", "Ручка", "жаровни", "2"]


def test_split_cells_joins_close_words() -> None:
    rows = group_rows(bom_sheet_lines())
    cells = split_cells(rows[1])
    assert [text for text, _ in cells] == ["5", "АБВ.301.12", "Ручка жаровни", "2"]


def test_bom_rows_carry_position_name_and_quantity() -> None:
    rows = extract_bom_rows(bom_sheet_lines())

    assert len(rows) == 3
    first = rows[0]
    assert first.position == 5
    assert first.designation == "АБВ.301.12"
    assert first.name == "Ручка жаровни"
    assert first.quantity == 2
    assert first.box.y == 640 and first.box.w > 400

    assert [(row.position, row.name, row.quantity) for row in rows[1:]] == [
        (6, "Кронштейн", 1),
        (7, "Болт М8", 4),
    ]
    assert rows[2].designation == "ГОСТ 7798-70"


def test_bom_table_needs_a_header_or_flat_pattern() -> None:
    drawing_only = [
        line("Ø20 H7", 300, 200),
        line("Ra 1,6", 420, 260),
        line("М8-7H", 250, 320),
        line("4 отв.", 360, 380),
    ]
    assert extract_bom_rows(drawing_only) == []


def test_flat_rows_without_header_are_read_by_structure() -> None:
    """Шапка не распозналась, но «5 Ручка жаровни 2» читается по структуре строки."""
    lines = [
        line("5 Ручка жаровни", 60, 300, 220),
        line("2", 300, 300, 14),
        line("6 Кронштейн", 60, 340, 200),
        line("1", 300, 340, 14),
    ]
    rows = extract_bom_rows(lines)

    assert [(row.position, row.name, row.quantity) for row in rows] == [
        (5, "Ручка жаровни", 2),
        (6, "Кронштейн", 1),
    ]


def test_bom_rows_stop_at_the_end_of_the_table() -> None:
    lines = bom_sheet_lines()
    # Текст технических требований далеко ниже таблицы не должен попасть в спецификацию.
    lines.append(line("1. Неуказанные предельные отклонения ±0,5 мм.", 60, 1200, 420))
    rows = extract_bom_rows(lines)
    assert len(rows) == 3


def test_views_are_recognised_with_canonical_names() -> None:
    lines = [
        line("Спереди", 220, 300, 90),
        line("Вид сбоку", 520, 300, 110),
        line("Сверху", 320, 620, 80),
        line("Изометрия", 700, 500, 110),
        line("Разрез А-А", 420, 720, 110),
        line("Ra 1,6", 250, 400, 70),
    ]
    views = extract_views(lines)
    # Порядок — как читает глаз: сверху вниз, внутри строки слева направо.
    assert [view.name for view in views] == ["Спереди", "Сбоку", "Изометрия", "Сверху", "Разрез А-А"]
    assert views[0].box.y == 300


def test_views_ignore_dimensions_and_duplicates() -> None:
    lines = [
        line("Сверху", 320, 620, 80),
        line("Сверху", 325, 622, 80),
        line("Ø20 H7", 250, 400, 80),
    ]
    views = extract_views(lines)
    assert len(views) == 1
    assert views[0].name == "Сверху"


def test_layout_scaled_keeps_percentages() -> None:
    layout = Layout(width=1000, height=1400, frame=Box(20, 20, 960, 1360), title_block=Box(760, 1180, 220, 200))
    scaled = layout.scaled(2.0)

    assert (scaled.width, scaled.height) == (2000, 2800)
    assert scaled.frame == Box(40, 40, 1920, 2720)
    before = layout.to_percent(layout.title_block)  # type: ignore[arg-type]
    after = scaled.to_percent(scaled.title_block)  # type: ignore[arg-type]
    assert np.allclose([before.x, before.y, before.w, before.h], [after.x, after.y, after.w, after.h])
