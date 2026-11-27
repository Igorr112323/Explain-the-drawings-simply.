"""Генератор боевого корпуса 2D-чертежей для QA («Завод хаоса»).

Создаёт 1 000+ уникальных файлов по восьми производственным категориям и пишет рядом
`index.jsonl` с ground truth: какие размеры, виды и строки спецификации реально нанесены
на лист. Прогон проверяет пайплайн против этих ожиданий, а не против самого себя.

Категории (по возрастанию сложности):
  1. gost_mech        — механообработка по ЕСКД: штамп 2.104, проекции, разрезы, размеры под ±90°;
  2. assembly_bom     — сборки с таблицей позиций (с шапкой и без), изометрия с номерами;
  3. welded           — сварные конструкции: Т1-К5, С2, У4-80/150, зачистка заподлицо;
  4. construction     — строительство/дерево/мебель: узлы, стропила, обвязка, габариты;
  5. small_web        — мелкие веб-картинки 380×280…750×550, webp и пережатый jpg;
  6. phone_photo      — «фото с телефона»: перспектива, повороты, тени, жёлтая бумага, шум;
  7. pdf_family       — векторные многолистовые PDF и скан-PDF (растр внутри);
  8. fuzz_garbage     — мусор и краш-файлы: 0 байт, обрезанные JPEG/PDF, 6000×4000, 4000×80,
                        пустой/чёрный лист, инъекции, длинные строки, эмодзи в имени.

Генерация детерминирована: один и тот же `--seed` даёт один и тот же корпус.

    python scripts/qa/generate_corpus.py --out qa/corpus --count 1000 --seed 20261126
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import random
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_REGULAR = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")

A4_W_MM, A4_H_MM = 297.0, 210.0
STAMP_W_MM, STAMP_H_MM = 185.0, 55.0
LEFT_MARGIN_MM, MARGIN_MM = 20.0, 5.0

DETAIL_NAMES = [
    "Кронштейн", "Пластина", "Втулка", "Фланец", "Рычаг", "Ось", "Корпус", "Крышка",
    "Держатель", "Ручка жаровни", "Упор", "Стойка", "Планка", "Уголок", "Траверса",
]
MATERIALS = ["Сталь 45", "Сталь 20", "09Г2С", "12Х18Н10Т", "40Х", "Ст 3", "Д16Т", "СЧ 20"]
CODES = ["МАМИ 019.046", "КС-04.100.000 СБ", "АБВ.301.12", "ГЧ.2024.118", "ТМ.55.07.004"]
SCALES = ["1:1", "1:2", "1:5", "2:1", "1:10"]
VIEW_LABELS = ["Спереди", "Сбоку", "Сверху", "Изометрия", "Снизу", "Сзади"]
BOM_PARTS = [
    "Ручка жаровни", "Кронштейн", "Болт М8", "Гайка М8", "Шайба 8", "Опора", "Стойка",
    "Пластина", "Втулка", "Ось", "Крышка", "Уголок 40×40", "Косынка", "Полка",
]
STANDARDS = ["ГОСТ 7798-70", "ГОСТ 5915-70", "ГОСТ 11371-78", "АБВ.301.12", "АБВ.301.13", ""]


@dataclass
class Case:
    slug: str
    category: str
    expect: dict = field(default_factory=dict)
    notes: str = ""


# ---------------------------------------------------------------------------- общие утилиты


def mm(value: float) -> float:
    """Миллиметры в пункты PDF."""
    return value / 25.4 * 72.0


def fitz_page(width_pt: float, height_pt: float) -> pymupdf.Page:
    return None  # type: ignore[return-value]  # заполняется в Doc, оставлено для читаемости


class VectorSheet:
    """Векторный лист A4 с рамкой, штампом ГОСТ 2.104 и произвольной графикой."""

    def __init__(self, doc: pymupdf.Document, page: pymupdf.Page | None = None) -> None:
        self.doc = doc
        self.page = page or doc.new_page(width=mm(A4_W_MM), height=mm(A4_H_MM))
        self.texts: list[str] = []
        self._frame()

    def _frame(self) -> None:
        page = self.page
        frame = pymupdf.Rect(mm(LEFT_MARGIN_MM), mm(MARGIN_MM), mm(A4_W_MM - MARGIN_MM), mm(A4_H_MM - MARGIN_MM))
        page.draw_rect(frame, color=(0, 0, 0), width=0.8)
        self.frame = frame
        self.stamp = pymupdf.Rect(
            frame.x1 - mm(STAMP_W_MM),
            frame.y1 - mm(STAMP_H_MM),
            frame.x1,
            frame.y1,
        )
        page.draw_rect(self.stamp, color=(0, 0, 0), width=0.8)
        for row in range(1, 5):
            y = self.stamp.y0 + self.stamp.height * row / 5
            page.draw_line((self.stamp.x0, y), (self.stamp.x1, y), color=(0, 0, 0), width=0.4)
        for column in (25, 65, 110, 135, 165):
            x = self.stamp.x0 + self.stamp.width * (column - 20) / 185
            self.page.draw_line((x, self.stamp.y0), (x, self.stamp.y1), color=(0, 0, 0), width=0.4)

    def text(self, x_mm: float, y_mm: float, value: str, size: float = 8.0, rotate: int = 0, bold: bool = False) -> None:
        font = FONT_BOLD if bold else FONT_REGULAR
        self.page.insert_text(
            (mm(x_mm), mm(y_mm)),
            value,
            fontsize=size,
            fontname="dejavu",
            fontfile=str(font),
            color=(0, 0, 0),
            rotate=rotate,
        )
        self.texts.append(value)

    def line(self, x1: float, y1: float, x2: float, y2: float, width: float = 0.5, dashes: str | None = None) -> None:
        self.page.draw_line((mm(x1), mm(y1)), (mm(x2), mm(y2)), color=(0, 0, 0), width=width, dashes=dashes)

    def rect(self, x1: float, y1: float, x2: float, y2: float, width: float = 0.5) -> None:
        self.page.draw_rect(pymupdf.Rect(mm(x1), mm(y1), mm(x2), mm(y2)), color=(0, 0, 0), width=width)

    def circle(self, cx: float, cy: float, radius: float, width: float = 0.5) -> None:
        self.page.draw_circle((mm(cx), mm(cy)), mm(radius), color=(0, 0, 0), width=width)

    def hatch(self, x1: float, y1: float, x2: float, y2: float, step: float = 2.4) -> None:
        """Штриховка разреза под 45° внутри прямоугольника."""
        length = math.hypot(x2 - x1, y2 - y1)
        offset = -length
        while offset < length + (y2 - y1):
            start_x = x1 + offset
            self.line(start_x, y1, start_x + (y2 - y1), y2, width=0.3)
            offset += step

    def dimension_h(self, x1: float, y: float, x2: float, label: str) -> None:
        """Горизонтальный размер со стрелками и текстом над линией."""
        self.line(x1, y, x2, y, width=0.35)
        self.line(x1, y - 1.2, x1, y + 1.2, width=0.35)
        self.line(x2, y - 1.2, x2, y + 1.2, width=0.35)
        self.text((x1 + x2) / 2 - len(label) * 0.9, y - 1.2, label, size=7.5)

    def dimension_v(self, x: float, y1: float, y2: float, label: str, direction: int = 90) -> None:
        """Вертикальный размер: текст повёрнут на 90° (или -90°), как на реальных чертежах."""
        self.line(x, y1, x, y2, width=0.35)
        self.line(x - 1.2, y1, x + 1.2, y1, width=0.35)
        self.line(x - 1.2, y2, x + 1.2, y2, width=0.35)
        rotate = 90 if direction > 0 else 270
        self.text(x - 1.6, (y1 + y2) / 2 + len(label) * 0.9, label, size=7.5, rotate=rotate)


def stamp_texts(sheet: VectorSheet, name: str, code: str, material: str, scale: str, mass: str | None) -> None:
    """Заполняет штамп ГОСТ 2.104: название, шифр, материал, масштаб, масса."""
    sheet.text(30, 170, name, size=10, bold=True)
    sheet.text(112, 170, code, size=7.5)
    sheet.text(30, 178, material, size=7.5)
    sheet.text(112, 178, "Масштаб " + scale, size=7)
    if mass:
        sheet.text(112, 186, "Масса " + mass + " кг", size=7)
    sheet.text(30, 186, "Лист 1", size=7)
    sheet.text(30, 194, "Разраб. Иванов", size=6.5)
    sheet.text(60, 194, "Пров. Петров", size=6.5)


# ---------------------------------------------------------------------------- категория 1


def category_gost_mech(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    """Механообработка по ЕСКД: проекции, разрез со штриховкой, вертикальные размеры."""
    for number in range(count):
        name = rng.choice(DETAIL_NAMES)
        material = rng.choice(MATERIALS)
        code = f"МАМИ {rng.randint(1, 999):03d}.{rng.randint(1, 999):03d}"
        scale = rng.choice(SCALES)
        diameter = rng.choice([20, 25, 30, 32, 40, 45, 50, 60, 80, 110])
        tolerance = rng.choice(["H7", "H8", "k6", "h6", "H7/k6", "H9"])
        thread = rng.choice(["М8-7H глуб. 20", "М10-7H", "М12×1,25-6H", "М6-7H глуб. 12"])
        roughness = rng.choice(["Ra 1,6", "Ra 3,2", "Ra 6,3", "Rz 20"])
        chamfer = rng.choice(["2×45°", "1×45°", "3×45°"])
        holes = rng.choice([2, 4, 6])
        hole_d = rng.choice([6, 8, 10, 12])
        angle = rng.choice([30, 45, 60, 90])
        doc = pymupdf.open()
        sheet = VectorSheet(doc)

        # Главный вид: прямоугольник с двумя отверстиями и осевыми линиями.
        cx, cy = 110, 90
        w, h = 80, 46
        sheet.rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, width=0.8)
        sheet.line(cx - w / 2 - 6, cy, cx + w / 2 + 6, cy, width=0.3, dashes="[4 2] 0")
        sheet.line(cx, cy - h / 2 - 6, cx, cy + h / 2 + 6, width=0.3, dashes="[4 2] 0")
        sheet.circle(cx, cy, diameter / 4)
        sheet.circle(cx, cy, diameter / 6, width=0.4)
        for sign in (-1, 1):
            sheet.circle(cx + sign * 26, cy - 12, hole_d / 2)
            sheet.line(cx + sign * 26 - 5, cy - 12, cx + sign * 26 + 5, cy - 12, width=0.25, dashes="[3 2] 0")

        # Вид сбоку и разрез со штриховкой.
        sheet.rect(cx + 62, cy - h / 2, cx + 62 + 42, cy + h / 2, width=0.7)
        sheet.hatch(cx + 62, cy - h / 2, cx + 62 + 42, cy - h / 2 + 6)
        sheet.text(cx + 62, cy + h / 2 + 8, "Разрез А-А", size=8)

        # Размеры: горизонтальные, вертикальные под 90° и -90°, диаметр, резьба.
        dimensions = [
            f"{diameter}",
            f"Ø{diameter} {tolerance}",
            f"{holes} отв. Ø{hole_d}",
            thread,
            roughness,
            chamfer,
            f"{w}",
            f"{h}",
            f"угол {angle}°",
            "12",
        ]
        sheet.dimension_h(cx - w / 2, cy + h / 2 + 12, cx + w / 2, f"{w}")
        sheet.dimension_h(cx - 26, cy - 26, cx + 26, f"{52}")
        sheet.dimension_v(cx - w / 2 - 12, cy - h / 2, cy + h / 2, f"{h}", direction=90)
        sheet.dimension_v(cx + w / 2 + 12, cy - h / 2, cy + h / 2, f"{h + 10}", direction=-90)
        sheet.text(cx + 2, cy - 22, f"Ø{diameter} {tolerance}", size=7.5)
        sheet.text(cx + 2, cy - 14, f"{holes} отв. Ø{hole_d}", size=7.5)
        sheet.text(cx + 30, cy + 30, thread, size=7.5)
        sheet.text(cx + 30, cy + 38, roughness, size=7.5)
        sheet.text(cx + 40, cy - 34, chamfer, size=7.5)
        sheet.text(cx + 26, cy + 18, f"{angle}°", size=7.5)
        for label in VIEW_LABELS[:3]:
            sheet.text(cx - 20, cy - h / 2 - 12, label, size=7.5)
            break

        stamp_texts(sheet, name, code, material, scale, f"{rng.uniform(0.4, 12):.1f}")
        path = out_dir / f"gost_{number:04d}_{name.replace(' ', '_')}.pdf"
        doc.save(str(path))
        doc.close()

        index.append(
            Case(
                slug=path.name,
                category="gost_mech",
                expect={
                    "kind": "vector",
                    "name": name,
                    "code": code,
                    "material": material,
                    "tokens": dimensions,
                    "views": ["Спереди"],
                    "bom_rows": 0,
                },
            ).__dict__
        )


# ---------------------------------------------------------------------------- категория 2


def category_assembly(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    """Сборка с таблицей позиций: шапка или строки без шапки, изометрия с номерами."""
    for number in range(count):
        with_header = number % 3 != 2
        rows_count = rng.randint(3, 7)
        parts = rng.sample(BOM_PARTS, rows_count)
        positions = list(range(1, rows_count + 1))
        rows = []
        for position, part in zip(positions, parts):
            standard = rng.choice(STANDARDS)
            quantity = rng.choice([1, 1, 2, 2, 4, 6])
            rows.append((position, standard or f"АБВ.{rng.randint(300, 399)}.{rng.randint(10, 99)}", part, quantity))

        doc = pymupdf.open()
        sheet = VectorSheet(doc)
        code = rng.choice(CODES)
        name = "Узел " + rng.choice(["привода", "крепления", "опоры", "жаровни", "поворота"])

        # Изометрия: рамка корпуса и номера позиций в кружках.
        origin_x, origin_y = 70, 70
        for step in range(rows_count):
            ox = origin_x + step * 6
            oy = origin_y - step * 4
            sheet.rect(ox, oy, ox + 60, oy + 34, width=0.6)
            sheet.text(ox + 4, oy + 8, parts[step], size=6.5)
            sheet.circle(ox + 56, oy + 4, 3.2)
            sheet.text(ox + 55, oy + 5.2, str(positions[step]), size=6.5)
            sheet.line(ox + 56, oy + 8, ox + 40, oy + 20, width=0.3)

        for label, x in zip(VIEW_LABELS[:3], (40, 130, 210)):
            sheet.text(x, 120, label, size=8)

        if with_header:
            header = ["ПОЗИЦИЯ", "ОБОЗНАЧЕНИЕ", "ОПИСАНИЕ", "К-ВО"]
            columns = (30.0, 52.0, 96.0, 168.0)
            for text, x in zip(header, columns):
                sheet.text(x, 130, text, size=7)
            for row_index, (position, standard, part, quantity) in enumerate(rows):
                y = 138 + row_index * 6
                sheet.text(columns[0], y, str(position), size=7)
                sheet.text(columns[1], y, standard, size=6.5)
                sheet.text(columns[2], y, part, size=7)
                sheet.text(columns[3], y, str(quantity), size=7)
        else:
            for row_index, (position, standard, part, quantity) in enumerate(rows):
                y = 132 + row_index * 6
                sheet.text(30, y, f"{position} {part}", size=7)
                sheet.text(168, y, str(quantity), size=7)
            sheet.text(30, 128, "Толщина стенок 4мм", size=7)

        stamp_texts(sheet, name, code, rng.choice(MATERIALS), rng.choice(SCALES), None)
        path = out_dir / f"assembly_{number:04d}_{rows_count}poz.pdf"
        doc.save(str(path))
        doc.close()

        index.append(
            Case(
                slug=path.name,
                category="assembly_bom",
                expect={
                    "kind": "vector",
                    "name": name,
                    "code": code,
                    "tokens": [row[2] for row in rows],
                    "views": ["Спереди", "Сбоку", "Сверху"],
                    "bom_rows": rows_count,
                    "bom_positions": [row[0] for row in rows],
                    "bom_with_header": with_header,
                },
            ).__dict__
        )


# ---------------------------------------------------------------------------- категория 3


def category_welded(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    """Сварные металлоконструкции: швы по контуру, обозначения ГОСТ 2.312."""
    for number in range(count):
        doc = pymupdf.open()
        sheet = VectorSheet(doc)
        code = f"СВ.{rng.randint(1, 999):03d}.{rng.randint(100, 999)}"
        weld = rng.choice(["Т1-К5", "С2", "У4-80/150", "Т3-Рн4", "Н1-К3"])
        legs = [rng.randint(40, 220), rng.randint(40, 160)]
        x0, y0 = 60, 60
        frame = (x0, y0, x0 + 120, y0 + 70)
        sheet.rect(*frame, width=0.9)
        sheet.line(frame[0], frame[1] + 30, frame[2], frame[1] + 30, width=0.7)
        for index_weld in range(rng.randint(2, 5)):
            side = index_weld % 4
            if side == 0:
                sheet.text(x0 + 10 + index_weld * 18, y0 - 4, weld, size=7.5)
            elif side == 1:
                sheet.text(x0 + 120 - 20, y0 + 12 + index_weld * 6, weld, size=7)
            elif side == 2:
                sheet.text(x0 + 10, y0 + 70 + 6, weld, size=7)
            else:
                sheet.text(x0 + 6, y0 + 40, "зачистить заподлицо", size=7)
        sheet.text(x0 + 6, y0 + 84, "Сварку выполнять по ГОСТ 14771-76", size=7)
        sheet.text(x0 + 6, y0 + 92, f"Катет шва {legs[0]//10} мм", size=7)
        sheet.dimension_h(x0, y0 + 100, x0 + 120, f"{frames_length(legs[0])}")
        sheet.dimension_v(x0 - 10, y0, y0 + 70, f"{legs[1]}", direction=90)
        stamp_texts(sheet, f"Рама {rng.choice(['опорная', 'приводная', 'под жаровню'])}", code, rng.choice(MATERIALS), "1:5", None)
        path = out_dir / f"weld_{number:04d}.pdf"
        doc.save(str(path))
        doc.close()
        index.append(
            Case(
                slug=path.name,
                category="welded",
                expect={
                    "kind": "vector",
                    "code": code,
                    "tokens": [weld, "зачистить заподлицо"],
                    "views": [],
                    "bom_rows": 0,
                },
            ).__dict__
        )


def frames_length(seed: int) -> int:
    return 100 + seed % 200


# ---------------------------------------------------------------------------- категория 4


def category_construction(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    """Строительство, дерево, мебель: узлы, стропила, обвязка, габариты — растровые листы."""
    for number in range(count):
        width, height = (1654, 1169) if number % 2 == 0 else (1240, 1754)  # A4 landscape / portrait
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(str(FONT_REGULAR), 22)
        bold = ImageFont.truetype(str(FONT_BOLD), 26)
        colour = (20, 20, 20) if number % 3 else (20, 60, 120)

        draw.rectangle([40, 40, width - 40, height - 40], outline=colour, width=2)
        # Каркас фермы: треугольники и связи.
        base_y = int(height * 0.55)
        span = width - 300
        points = [(150 + i * span // 6, base_y - (60 if i % 2 else 0)) for i in range(7)]
        for left, right in zip(points, points[1:]):
            draw.line([left, right], fill=colour, width=3)
        draw.line([points[0], points[-1]], fill=colour, width=3)
        for index_node, point in enumerate(points):
            draw.ellipse([point[0] - 6, point[1] - 6, point[0] + 6, point[1] + 6], outline=colour, width=2)
            draw.text((point[0] + 10, point[1] - 26), f"Узел {['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][index_node % 7]}", font=font, fill=colour)

        labels = ["Стропило 50×150", "Нижняя обвязка", "Опора 80×80 мм", "Раскос 40×100", "Стойка 100×100"]
        for index_label, text in enumerate(labels[: rng.randint(3, 5)]):
            draw.text((160, 120 + index_label * 34), text, font=font, fill=colour)
            draw.line([(160, 140 + index_label * 34), (300 + index_label * 90, base_y - 40)], fill=colour, width=1)

        size = rng.choice(["2500×2100", "3200×1800", "4000×2400", "1800×900"])
        draw.text((width // 2 - 90, height - 140), size, font=bold, fill=colour)
        draw.line([(150, height - 110), (width - 150, height - 110)], fill=colour, width=2)
        draw.text((width - 430, height - 90), "Масштаб 1:20", font=font, fill=colour)
        draw.text((width - 430, height - 60), "Сталь 09Г2С", font=font, fill=colour)

        if number % 4 == 0:
            image = image.filter(ImageFilter.GaussianBlur(1.2))
        path = out_dir / f"build_{number:04d}.png"
        image.save(path, optimize=True)
        index.append(
            Case(
                slug=path.name,
                category="construction",
                expect={
                    "kind": "raster",
                    "tokens": ["Стропило", size],
                    "views": [],
                    "bom_rows": 0,
                },
            ).__dict__
        )


# ---------------------------------------------------------------------------- категория 5


def small_sheet(rng: random.Random, width: int, height: int) -> Image.Image:
    """Мелкий лист: рамка, штамп, несколько размеров — как скриншот из интернета."""
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    scale = width / 700.0
    font = ImageFont.truetype(str(FONT_REGULAR), max(9, int(13 * scale)))
    small = ImageFont.truetype(str(FONT_REGULAR), max(7, int(9 * scale)))
    ink = (25, 25, 25)
    draw.rectangle([8, 8, width - 8, height - 8], outline=ink, width=2)
    draw.rectangle([width - int(width * 0.42), height - int(height * 0.22), width - 8, height - 8], outline=ink, width=1)
    draw.text((20, height - int(height * 0.18)), rng.choice(DETAIL_NAMES), font=font, fill=ink)
    draw.text((20, height - int(height * 0.11)), rng.choice(MATERIALS), font=small, fill=ink)
    draw.text((width - int(width * 0.4), height - int(height * 0.1)), rng.choice(CODES), font=small, fill=ink)

    cx, cy = width // 2 - 20, height // 2 - 30
    draw.rectangle([cx - 90 * scale, cy - 50 * scale, cx + 90 * scale, cy + 50 * scale], outline=ink, width=2)
    draw.ellipse([cx - 22 * scale, cy - 22 * scale, cx + 22 * scale, cy + 22 * scale], outline=ink, width=2)
    label = rng.choice(["Ø20 H7", "Ø32 H8", "Ø45 k6", "Ø110", "4 отв. Ø10", "М8-7H", "Ra 1,6", "2×45°"])
    draw.text((cx - 40 * scale, cy + 60 * scale), label, font=font, fill=ink)
    draw.text((30, 40), rng.choice(VIEW_LABELS[:3]), font=font, fill=ink)
    draw.line([(30, height - int(height * 0.3)), (width - 30, height - int(height * 0.3))], fill=ink, width=1)
    return image


def category_small_web(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    for number in range(count):
        width = rng.randint(380, 750)
        height = rng.randint(280, 550)
        image = small_sheet(rng, width, height)
        if number % 3 == 0:
            path = out_dir / f"web_{number:04d}.webp"
            image.save(path, "WEBP", quality=rng.choice([45, 60, 75]))
        else:
            buffer = io.BytesIO()
            image.save(buffer, "JPEG", quality=rng.choice([35, 50, 65, 80]))
            path = out_dir / f"web_{number:04d}.jpg"
            path.write_bytes(buffer.getvalue())
        if number % 5 == 0:
            # Водяной знак поверх штампа — типичная беда картинок из интернета.
            marked = Image.open(path).convert("RGB")
            draw = ImageDraw.Draw(marked)
            draw.text((20, 20), "WWW.CHERtezhi.ru", font=ImageFont.truetype(str(FONT_BOLD), 18), fill=(190, 190, 190))
            marked.save(path)
        index.append(
            Case(
                slug=path.name,
                category="small_web",
                expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0, "width": width, "height": height},
            ).__dict__
        )


# ---------------------------------------------------------------------------- категория 6


def photo_of_sheet(image: Image.Image, rng: random.Random) -> Image.Image:
    """«Фото с телефона»: перспектива, жёсткая тень, жёлтая бумага, шум, смаз."""
    width, height = image.size
    array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    tilt = rng.uniform(5, 18)
    shift_x = rng.uniform(0.03, 0.09) * width
    shift_y = rng.uniform(0.02, 0.07) * height
    source = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    target = np.float32(
        [
            [shift_x, shift_y],
            [width - shift_x * rng.uniform(0.4, 1.2), shift_y * 0.6],
            [width - shift_x * 0.3, height - shift_y],
            [shift_x * 0.7, height - shift_y * 1.2],
        ]
    )
    matrix = cv2.getPerspectiveTransform(source, target)
    warped = cv2.warpPerspective(array, matrix, (width, height), borderValue=(238, 240, 240))

    # Тень от лампы: градиент по диагонали.
    gradient = np.linspace(0.75, 1.0, width).reshape(1, width, 1)
    warped = np.clip(warped.astype(np.float32) * gradient, 0, 255).astype(np.uint8)

    # Жёлтая бумага и лёгкие пятна масла. Раньше здесь был GaussianBlur(σ=6) на каждое пятно:
    # после двух-трёх проходов текст превращался в кашу, и «фото» переставало быть фото
    # чертежа — снимать его так, чтобы ничего не читалось, никто не будет.
    tint = np.array([0.96, 0.99, 1.05], dtype=np.float32)
    warped = np.clip(warped.astype(np.float32) * tint, 0, 255).astype(np.uint8)
    for _ in range(rng.randint(1, 2)):
        x, y = rng.randint(0, width), rng.randint(0, height)
        radius = rng.randint(8, 32)
        overlay = warped.copy()
        cv2.circle(overlay, (x, y), radius, (150, 160, 168), -1)
        warped = cv2.addWeighted(overlay, 0.25, warped, 0.75, 0)

    noise = np.random.default_rng(rng.randint(0, 10_000)).normal(0, rng.uniform(3, 7), warped.shape)
    warped = np.clip(warped.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    if rng.random() < 0.35:
        # Лёгкая нерезкость объектива телефона, а не «смаз»: ядро 3 и σ ≤ 0,6 сохраняют штрихи.
        warped = cv2.GaussianBlur(warped, (3, 3), rng.uniform(0.3, 0.6))
    if rng.random() < 0.4:
        warped = cv2.convertScaleAbs(warped, alpha=rng.uniform(0.86, 0.96), beta=-6)
    rotation = rng.choice([0, 0, 90, 180, 270])
    if rotation:
        warped = cv2.rotate(warped, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[rotation])
    return Image.fromarray(cv2.cvtColor(warped, cv2.COLOR_BGR2RGB))


def category_phone_photo(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    for number in range(count):
        base = small_sheet(rng, 1400, 990) if number % 2 else Image.open(
            next(out_dir.glob("build_*.png"))
        ) if list(out_dir.glob("build_*.png")) else small_sheet(rng, 1400, 990)
        photo = photo_of_sheet(base.convert("RGB"), rng)
        path = out_dir / f"photo_{number:04d}.jpg"
        buffer = io.BytesIO()
        photo.save(buffer, "JPEG", quality=rng.choice([60, 70, 80, 88]))
        path.write_bytes(buffer.getvalue())
        index.append(
            Case(
                slug=path.name,
                category="phone_photo",
                expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0},
            ).__dict__
        )


# ---------------------------------------------------------------------------- категория 7


def category_pdf_family(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    """Многолистовые векторные PDF и скан-PDF без текстового слоя."""
    for number in range(count):
        pages = rng.randint(1, 4)
        scanned = number % 3 == 0
        doc = pymupdf.open()
        codes = [f"СБ.{rng.randint(1, 999):03d}.{page:02d}" for page in range(pages)]
        tokens: list[str] = []
        for page_index in range(pages):
            if scanned:
                sheet_image = small_sheet(rng, 1654, 1169)
                ok, encoded = cv2.imencode(".png", cv2.cvtColor(np.array(sheet_image), cv2.COLOR_RGB2BGR))
                page = doc.new_page(width=mm(A4_W_MM), height=mm(A4_H_MM))
                page.insert_image(page.rect, stream=encoded.tobytes())
            else:
                sheet = VectorSheet(doc)
                cx, cy = 120, 90
                sheet.rect(cx - 60, cy - 35, cx + 60, cy + 35, width=0.8)
                sheet.circle(cx, cy, rng.choice([10, 15, 20]))
                label = rng.choice(["Ø20 H7", "Ø32 H8", "М10-7H", "Ra 3,2", f"{rng.randint(20, 200)}"])
                tokens.append(label)
                sheet.text(cx + 4, cy - 45, label, size=8)
                sheet.dimension_h(cx - 60, cy + 45, cx + 60, "120")
                sheet.text(cx - 50, cy - 45, f"Лист {page_index + 1}", size=8)
                stamp_texts(sheet, rng.choice(DETAIL_NAMES), codes[page_index], rng.choice(MATERIALS), rng.choice(SCALES), None)
        path = out_dir / f"multi_{number:04d}_{pages}p{'_scan' if scanned else ''}.pdf"
        doc.save(str(path))
        doc.close()
        index.append(
            Case(
                slug=path.name,
                category="pdf_family",
                expect={
                    "kind": "pdf",
                    "pages": pages,
                    "tokens": tokens,
                    "views": [],
                    "bom_rows": 0,
                    "scanned": scanned,
                },
            ).__dict__
        )


# ---------------------------------------------------------------------------- категория 8

INJECTION = '<script>alert(1)</script> ../../etc/passwd C:\\test\\..\\..'


def category_fuzz(out_dir: Path, index: list[dict], rng: random.Random, count: int) -> None:
    """Мусор, границы и краш-файлы: сервер обязан ответить 4xx и остаться живым."""
    doc = pymupdf.open()
    sheet = VectorSheet(doc)
    sheet.text(40, 60, INJECTION, size=9)
    sheet.text(40, 75, "Д" * 400, size=7)
    long_line = "1 " + "Деталь " * 300 + " 2"
    sheet.text(40, 90, long_line[:2000], size=5)
    stamp_texts(sheet, INJECTION, "МАМИ 019.046", "Сталь 45", "1:1", None)
    buffer = io.BytesIO()
    doc.save(buffer)
    doc.close()
    injection_pdf = buffer.getvalue()

    blank = Image.new("RGB", (800, 1120), "white")
    blank_path = out_dir / "fuzz_blank_white.png"
    blank.save(blank_path)
    index.append(Case(slug=blank_path.name, category="fuzz_blank", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0, "status": "ok_or_422"}).__dict__)

    black = Image.new("RGB", (900, 1200), "black")
    black_path = out_dir / "fuzz_black.png"
    black.save(black_path)
    index.append(Case(slug=black_path.name, category="fuzz_black", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0, "status": "ok_or_422"}).__dict__)

    huge = small_sheet(rng, 3000, 2000).resize((6000, 4000))
    huge_path = out_dir / "fuzz_huge_6000x4000.jpg"
    huge.save(huge_path, "JPEG", quality=70)
    index.append(Case(slug=huge_path.name, category="fuzz_huge", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    strip = small_sheet(rng, 700, 500).resize((4000, 80))
    strip_path = out_dir / "fuzz_strip_4000x80.png"
    strip.save(strip_path)
    index.append(Case(slug=strip_path.name, category="fuzz_strip", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    zero_path = out_dir / "fuzz_zero_bytes.png"
    zero_path.write_bytes(b"")
    index.append(Case(slug=zero_path.name, category="fuzz_corrupt", expect={"kind": "broken", "tokens": [], "views": [], "bom_rows": 0, "status": "4xx"}).__dict__)

    # Обрезанные JPEG: валидная картинка без хвоста.
    good_buffer = io.BytesIO()
    small_sheet(rng, 900, 700).save(good_buffer, "JPEG", quality=80)
    jpeg = good_buffer.getvalue()
    for cut in (len(jpeg) // 2, len(jpeg) - 30, 120):
        path = out_dir / f"fuzz_truncated_{cut:05d}.jpg"
        path.write_bytes(jpeg[:cut])
        index.append(Case(slug=path.name, category="fuzz_corrupt", expect={"kind": "broken", "tokens": [], "views": [], "bom_rows": 0, "status": "4xx_or_ok"}).__dict__)

    for cut in (len(injection_pdf) // 3, len(injection_pdf) - 40):
        path = out_dir / f"fuzz_truncated_pdf_{cut:05d}.pdf"
        path.write_bytes(injection_pdf[:cut])
        index.append(Case(slug=path.name, category="fuzz_corrupt", expect={"kind": "broken", "tokens": [], "views": [], "bom_rows": 0, "status": "4xx"}).__dict__)

    path = out_dir / "fuzz_injection.pdf"
    path.write_bytes(injection_pdf)
    index.append(Case(slug=path.name, category="fuzz_injection", expect={"kind": "pdf", "tokens": [], "views": [], "bom_rows": 0, "status": "ok_or_422"}).__dict__)

    emoji_name = "fuzz_чертёж_№46_🧨_«тест».png"
    small_sheet(rng, 800, 600).save(out_dir / emoji_name)
    index.append(Case(slug=emoji_name, category="fuzz_name", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    space_name = "fuzz_имя с пробелами и Ё.png"
    small_sheet(rng, 760, 560).save(out_dir / space_name)
    index.append(Case(slug=space_name, category="fuzz_name", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    # Не-картинка с расширением картинки и наоборот.
    path = out_dir / "fuzz_text_as_png.png"
    path.write_bytes("это не картинка, а текст\n".encode("utf-8") * 20)
    index.append(Case(slug=path.name, category="fuzz_corrupt", expect={"kind": "broken", "tokens": [], "views": [], "bom_rows": 0, "status": "4xx"}).__dict__)

    path = out_dir / "fuzz_image_as_pdf.pdf"
    image_buffer = io.BytesIO()
    small_sheet(rng, 700, 500).save(image_buffer, "PNG")
    path.write_bytes(image_buffer.getvalue())
    index.append(Case(slug=path.name, category="fuzz_corrupt", expect={"kind": "broken", "tokens": [], "views": [], "bom_rows": 0, "status": "4xx_or_ok"}).__dict__)

    # Маленькие картинки-вырожденцы и 16-бит PNG, CMYK JPEG.
    tiny = Image.new("RGB", (8, 8), "white")
    path = out_dir / "fuzz_tiny_8x8.png"
    tiny.save(path)
    index.append(Case(slug=path.name, category="fuzz_tiny", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    one_pixel_line = Image.new("RGB", (1200, 1), "white")
    path = out_dir / "fuzz_line_1200x1.png"
    one_pixel_line.save(path)
    index.append(Case(slug=path.name, category="fuzz_strip", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    sixteen = np.full((900, 700), 60000, dtype=np.uint16)
    cv2.imwrite(str(out_dir / "fuzz_16bit.png"), sixteen)
    index.append(Case(slug="fuzz_16bit.png", category="fuzz_depth", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    cmyk = small_sheet(rng, 800, 600).convert("CMYK")
    cmyk.save(out_dir / "fuzz_cmyk.jpg", "JPEG", quality=70)
    index.append(Case(slug="fuzz_cmyk.jpg", category="fuzz_depth", expect={"kind": "raster", "tokens": [], "views": [], "bom_rows": 0}).__dict__)

    # Добиваем до нужного количества детерминированными вариациями мусора.
    while len([item for item in index if item["category"].startswith("fuzz")]) < count:
        variant = len([item for item in index if item["category"].startswith("fuzz")])
        kind = variant % 5
        if kind == 0:
            noise = np.random.default_rng(variant).integers(0, 255, (720, 560, 3), dtype=np.uint8)
            name = f"fuzz_noise_{variant:03d}.png"
            cv2.imwrite(str(out_dir / name), noise)
        elif kind == 1:
            name = f"fuzz_noise_jpeg_{variant:03d}.jpg"
            noise = np.random.default_rng(variant).integers(0, 255, (600, 480, 3), dtype=np.uint8)
            cv2.imwrite(str(out_dir / name), noise)
        elif kind == 2:
            jpeg_bytes = bytearray(jpeg)
            for position in range(0, min(400, len(jpeg_bytes)), 7):
                jpeg_bytes[position] = (jpeg_bytes[position] + variant * 13) % 256
            name = f"fuzz_mutated_{variant:03d}.jpg"
            (out_dir / name).write_bytes(bytes(jpeg_bytes))
        elif kind == 3:
            pdf_bytes = bytearray(injection_pdf)
            for position in range(0, min(600, len(pdf_bytes)), 11):
                pdf_bytes[position] = (pdf_bytes[position] + variant * 7) % 256
            name = f"fuzz_mutated_{variant:03d}.pdf"
            (out_dir / name).write_bytes(bytes(pdf_bytes))
        else:
            name = f"fuzz_blank_portrait_{variant:03d}.png"
            Image.new("RGB", (1200, 1700), (250, 250, 250)).save(out_dir / name)
        index.append(
            Case(
                slug=name,
                category="fuzz_mutated",
                expect={"kind": "broken_or_raster", "tokens": [], "views": [], "bom_rows": 0, "status": "any"},
            ).__dict__
        )


# ---------------------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description="Генератор QA-корпуса 2D-чертежей")
    parser.add_argument("--out", default="qa/corpus", type=Path)
    parser.add_argument("--count", default=1000, type=int, help="сколько чертежей сгенерировать (без мусора)")
    parser.add_argument("--fuzz", default=60, type=int, help="сколько мусорных файлов добавить")
    parser.add_argument("--seed", default=20261126, type=int)
    parser.add_argument("--clean", action="store_true", help="очистить папку корпуса перед генерацией")
    args = parser.parse_args()

    out_dir: Path = args.out
    if args.clean and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    index: list[dict] = []

    # Пропорции: вектор дешёвый и быстрый, растровые категории тяжелее — их меньше.
    budget = args.count
    plan = [
        ("gost_mech", category_gost_mech, int(budget * 0.22)),
        ("assembly_bom", category_assembly, int(budget * 0.17)),
        ("welded", category_welded, int(budget * 0.10)),
        ("construction", category_construction, int(budget * 0.12)),
        ("small_web", category_small_web, int(budget * 0.12)),
        ("phone_photo", category_phone_photo, int(budget * 0.12)),
        ("pdf_family", category_pdf_family, int(budget * 0.15)),
    ]
    # Свой генератор на каждую категорию: правка одной категории не сдвигает остальные,
    # а прогон остаётся воспроизводимым по одному `--seed`.
    for name, function, amount in plan:
        print(f"▸ {name}: {amount}")
        function(out_dir, index, random.Random(f"{args.seed}:{name}"), amount)

    print(f"▸ fuzz: {args.fuzz}")
    category_fuzz(out_dir, index, random.Random(f"{args.seed}:fuzz"), args.fuzz)

    index_path = out_dir / "index.jsonl"
    with index_path.open("w", encoding="utf-8") as handle:
        for item in index:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")

    total_bytes = sum(f.stat().st_size for f in out_dir.iterdir() if f.is_file())
    print(f"✓ {len(index)} файлов, {total_bytes / 1024 / 1024:.1f} МБ, индекс: {index_path}")


if __name__ == "__main__":
    main()
