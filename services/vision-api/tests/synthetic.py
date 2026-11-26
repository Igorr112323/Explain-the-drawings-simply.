"""Synthetic A4 drawing with a GOST 2.104 stamp.

Everything the vision service is tested against is generated here: no downloads, no fixtures
committed to the repository. Two flavours are produced:

* `render_drawing()` — a clean 150 dpi raster used for layout/quality tests.
* `photo_of()` — the same sheet photographed at an angle, with a shadow and sensor noise.
* `build_vector_pdf()` — a real vector PDF with a text layer for the 100 % extraction test.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
FONT_REGULAR = FONT_DIR / "DejaVuSans.ttf"
FONT_BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"

A4_W_MM = 297.0
A4_H_MM = 210.0
STAMP_W_MM = 185.0
STAMP_H_MM = 55.0
LEFT_MARGIN_MM = 20.0
MARGIN_MM = 5.0

DRAWING_CODE = "КС-04.100.000 СБ"
DRAWING_NAME = "Кронштейн"
MATERIAL = "09Г2С"
SCALE = "1:2"
DIMENSIONS = ["Ø20 H7", "М8-7H", "Ra 1,6", "Т1-К5", "4 отв."]
AMBIGUOUS_NUMBER = "12"
TECH_REQUIREMENTS = [
    "1. Неуказанные предельные отклонения ±0,5 мм.",
    "2. Шероховатость Ra 6,3.",
]


@dataclass(frozen=True)
class SheetGeometry:
    width_px: int
    height_px: int
    dpi: int
    frame: tuple[int, int, int, int]
    stamp: tuple[int, int, int, int]

    @staticmethod
    def for_dpi(dpi: int) -> "SheetGeometry":
        scale = dpi / 25.4

        def mm(value: float) -> int:
            return int(round(value * scale))

        width = mm(A4_W_MM)
        height = mm(A4_H_MM)
        frame = (mm(LEFT_MARGIN_MM), mm(MARGIN_MM), width - mm(MARGIN_MM), height - mm(MARGIN_MM))
        stamp = (
            frame[2] - mm(STAMP_W_MM),
            frame[3] - mm(STAMP_H_MM),
            frame[2],
            frame[3],
        )
        return SheetGeometry(width_px=width, height_px=height, dpi=dpi, frame=frame, stamp=stamp)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REGULAR), size)


def render_drawing(dpi: int = 150, with_tech_requirements: bool = True) -> np.ndarray:
    """Clean raster of the sheet: frame, stamp, dimension callouts, tech requirements."""
    geometry = SheetGeometry.for_dpi(dpi)
    scale = dpi / 25.4
    image = Image.new("RGB", (geometry.width_px, geometry.height_px), "white")
    draw = ImageDraw.Draw(image)

    draw.rectangle(geometry.frame, outline="black", width=max(2, int(scale * 0.7)))
    x0, y0, x1, y1 = geometry.frame

    # --- drawing content -----------------------------------------------------------------
    cx, cy = int(scale * 120), int(scale * 80)
    radius = int(scale * 18)
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline="black", width=max(2, int(scale * 0.5)))
    draw.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), outline="black", width=1)
    draw.line((cx, cy - radius - int(scale * 8), cx, cy + radius + int(scale * 8)), fill="black", width=1)
    draw.line((cx - radius - int(scale * 8), cy, cx + radius + int(scale * 8), cy), fill="black", width=1)

    body = (int(scale * 200), int(scale * 40), int(scale * 270), int(scale * 110))
    draw.rectangle(body, outline="black", width=max(2, int(scale * 0.6)))
    for hole in range(4):
        hx = int(scale * (208 + hole * 18))
        draw.ellipse((hx, int(scale * 52), hx + int(scale * 6), int(scale * 58)), outline="black", width=1)

    label_font = _font(max(12, int(scale * 4.0)))
    draw.text((int(scale * 100), int(scale * 36)), DRAWING_NAME, fill="black", font=_font(max(14, int(scale * 5.0)), bold=True))
    draw.text((cx - radius, cy + radius + int(scale * 6)), DIMENSIONS[0], fill="black", font=label_font)
    draw.text((body[0], body[1] - int(scale * 7)), DIMENSIONS[1], fill="black", font=label_font)
    draw.text((body[0] + int(scale * 12), body[3] + int(scale * 3)), DIMENSIONS[2], fill="black", font=label_font)
    draw.text((int(scale * 40), int(scale * 150)), DIMENSIONS[3], fill="black", font=label_font)
    draw.text((int(scale * 210), int(scale * 130)), DIMENSIONS[4], fill="black", font=label_font)
    draw.text((int(scale * 150), int(scale * 150)), AMBIGUOUS_NUMBER, fill="black", font=_font(max(12, int(scale * 3.6))))

    # --- tech requirements above the stamp ------------------------------------------------
    if with_tech_requirements:
        font = _font(max(11, int(scale * 3.2)))
        for index, line in enumerate(TECH_REQUIREMENTS):
            draw.text(
                (geometry.stamp[0] + int(scale * 2), geometry.stamp[1] - int(scale * (4 + index * 5))),
                line,
                fill="black",
                font=font,
            )

    # --- stamp (ГОСТ 2.104) ---------------------------------------------------------------
    sx0, sy0, sx1, sy1 = geometry.stamp
    draw.rectangle(geometry.stamp, outline="black", width=max(2, int(scale * 0.7)))
    for row in range(1, 5):
        y = sy0 + int((sy1 - sy0) * row / 5)
        draw.line((sx0, y, sx1, y), fill="black", width=1)
    for column in (110, 135, 165):
        x = sx0 + int((sx1 - sx0) * (column - 20) / 272)
        draw.line((x, sy0, x, sy1), fill="black", width=1)

    stamp_font = _font(max(12, int(scale * 3.6)))
    big_font = _font(max(14, int(scale * 5.2)), bold=True)
    draw.text((sx0 + int(scale * 68), sy0 + int(scale * 2)), DRAWING_CODE, fill="black", font=big_font)
    draw.text((sx0 + int(scale * 68), sy0 + int(scale * 13)), DRAWING_NAME, fill="black", font=stamp_font)
    draw.text((sx0 + int(scale * 68), sy0 + int(scale * 24)), MATERIAL, fill="black", font=stamp_font)
    draw.text((sx0 + int(scale * 68), sy0 + int(scale * 35)), f"Масса 2,4 кг", fill="black", font=stamp_font)
    draw.text((sx0 + int(scale * 68), sy0 + int(scale * 46)), f"Масштаб {SCALE}", fill="black", font=stamp_font)
    draw.text((sx0 + int(scale * 4), sy1 - int(scale * 12)), "Разраб. Иванов", fill="black", font=stamp_font)
    draw.text((sx0 + int(scale * 140), sy1 - int(scale * 12)), "Лист 1 Листов 1", fill="black", font=stamp_font)

    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def photo_of(image: np.ndarray, *, angle: float = 7.0, shadow: bool = True, noise: float = 6.0, blur: float = 1.2) -> np.ndarray:
    """Simulates a phone photo: sheet on a dark table, slightly rotated, with shadow and noise."""
    height, width = image.shape[:2]
    zoom = 0.72
    sheet_w, sheet_h = int(width * zoom), int(height * zoom)
    radians = np.deg2rad(abs(angle))
    rotated_w = int(sheet_w * np.cos(radians) + sheet_h * np.sin(radians))
    rotated_h = int(sheet_w * np.sin(radians) + sheet_h * np.cos(radians))
    canvas_width = int(rotated_w + 0.12 * sheet_w)
    canvas_height = int(rotated_h + 0.12 * sheet_h)
    canvas = np.full((canvas_height, canvas_width, 3), 70, dtype=np.uint8)

    sheet = cv2.resize(src=image, dsize=(sheet_w, sheet_h), interpolation=cv2.INTER_AREA)
    corners = np.float32([[0, 0], [sheet_w, 0], [sheet_w, sheet_h], [0, sheet_h]])
    matrix = cv2.getRotationMatrix2D((sheet_w / 2, sheet_h / 2), angle, 1.0)
    matrix[0, 2] += (canvas_width - sheet_w) / 2
    matrix[1, 2] += (canvas_height - sheet_h) / 2
    warped = cv2.warpAffine(sheet, matrix, (canvas_width, canvas_height), borderValue=(70, 70, 70))

    mask = np.zeros((canvas_height, canvas_width), np.uint8)
    cv2.fillConvexPoly(mask, cv2.transform(corners.reshape(1, -1, 2), matrix).astype(np.int32), 255)
    canvas[mask > 0] = warped[mask > 0]

    if shadow:
        # Window light from the left plus the photographer's hand shading the lower right corner:
        # a real phone photo of a drawing is never evenly lit.
        ramp = np.linspace(1.0, 0.2, canvas_width, dtype=np.float32)
        ramp = np.repeat(ramp[None, :], canvas_height, axis=0)
        ramp = cv2.GaussianBlur(ramp, (0, 0), 70)
        blob = np.zeros((canvas_height, canvas_width), np.float32)
        cv2.ellipse(
            blob,
            (int(canvas_width * 0.85), int(canvas_height * 1.0)),
            (int(canvas_width * 0.30), int(canvas_height * 0.35)),
            0,
            0,
            360,
            1.0,
            -1,
        )
        blob = cv2.GaussianBlur(blob, (0, 0), 80)
        shadow_map = np.clip(ramp - 0.35 * blob, 0.1, 1.0)
        canvas = np.clip(canvas.astype(np.float32) * (0.45 + 0.55 * shadow_map[..., None]), 0, 255).astype(np.uint8)

    if blur > 0:
        canvas = cv2.GaussianBlur(canvas, (0, 0), blur)
    if noise > 0:
        rng = np.random.default_rng(seed=7)
        grain = rng.normal(0.0, noise, canvas.shape).astype(np.float32)
        canvas = np.clip(canvas.astype(np.float32) + grain, 0, 255).astype(np.uint8)
    return canvas


def encode_png(image: np.ndarray) -> bytes:
    success, buffer = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("PNG encoding failed")
    return buffer.tobytes()


def dark_image(base: np.ndarray | None = None) -> np.ndarray:
    source = render_drawing(150) if base is None else base
    return np.clip(source.astype(np.float32) * 0.12, 0, 255).astype(np.uint8)


def blurry_image(base: np.ndarray | None = None) -> np.ndarray:
    source = render_drawing(150) if base is None else base
    return cv2.GaussianBlur(source, (0, 0), 9.0)


VECTOR_TEXTS = [
    ("Кронштейн", (60, 40), 16),
    ("Ø20 H7", (60, 80), 12),
    ("М8-7H", (60, 100), 12),
    ("Ra 1,6", (60, 120), 10),
    ("Т1-К5", (60, 140), 10),
    ("КС-04.100.000 СБ", (150, 163), 14),
    ("Кронштейн", (150, 176), 11),
    ("09Г2С", (150, 189), 10),
    ("1:2", (255, 189), 10),
    ("Лист 1 Листов 1", (255, 176), 9),
]


def build_vector_pdf(scale: str = "1:2") -> bytes:
    """Vector PDF with a real text layer; coordinates in millimetres → PDF points."""
    width_pt, height_pt = A4_W_MM / 25.4 * 72, A4_H_MM / 25.4 * 72
    document = pymupdf.open()
    page = document.new_page(width=width_pt, height=height_pt)
    font = pymupdf.Font(fontfile=str(FONT_REGULAR))

    def mm(value: float) -> float:
        return value / 25.4 * 72

    frame = pymupdf.Rect(mm(LEFT_MARGIN_MM), mm(MARGIN_MM), width_pt - mm(MARGIN_MM), height_pt - mm(MARGIN_MM))
    page.draw_rect(frame, color=(0, 0, 0), width=0.8)

    stamp = pymupdf.Rect(frame.x1 - mm(STAMP_W_MM), frame.y1 - mm(STAMP_H_MM), frame.x1, frame.y1)
    page.draw_rect(stamp, color=(0, 0, 0), width=0.8)
    for row in range(1, 5):
        y = stamp.y0 + (stamp.height * row / 5)
        page.draw_line((stamp.x0, y), (stamp.x1, y), color=(0, 0, 0), width=0.4)
    for column in (110, 135, 165):
        x = stamp.x0 + stamp.width * (column - 20) / 272
        page.draw_line((x, stamp.y0), (x, stamp.y1), color=(0, 0, 0), width=0.4)

    page.draw_circle((mm(120), mm(80)), mm(18), color=(0, 0, 0), width=0.5)

    for text, (x_mm, y_mm), size in VECTOR_TEXTS:
        replaced = text if text != "1:2" else scale
        page.insert_text((mm(x_mm), mm(y_mm)), replaced, fontsize=size, fontname="dejavu", fontfile=str(FONT_REGULAR), color=(0, 0, 0))

    page.insert_text((mm(110), mm(146)), "Неуказанные предельные отклонения ±0,5 мм", fontsize=9, fontname="dejavu", fontfile=str(FONT_REGULAR))

    buffer = io.BytesIO()
    document.save(buffer)
    document.close()
    _ = font  # keep the font referenced for clarity
    return buffer.getvalue()


def scanned_pdf(dpi: int = 200) -> bytes:
    """A PDF without a text layer: the page is a single raster image (a scan)."""
    image = render_drawing(dpi)
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    width_pt, height_pt = A4_W_MM / 25.4 * 72, A4_H_MM / 25.4 * 72
    document = pymupdf.open()
    page = document.new_page(width=width_pt, height=height_pt)
    page.insert_image(page.rect, stream=encoded.tobytes())
    buffer = io.BytesIO()
    document.save(buffer)
    document.close()
    return buffer.getvalue()


def multipage_pdf() -> bytes:
    """Sheet 1 is a vector drawing, sheet 2 is a specification table."""
    drawing = pymupdf.open(stream=build_vector_pdf(), filetype="pdf")
    spec_page = drawing.new_page(width=A4_W_MM / 25.4 * 72, height=A4_H_MM / 25.4 * 72)
    spec_page.insert_text((72, 100), "Спецификация", fontsize=16, fontname="dejavu", fontfile=str(FONT_REGULAR))
    spec_page.insert_text((72, 130), "Поз. 4  Кронштейн  1", fontsize=11, fontname="dejavu", fontfile=str(FONT_REGULAR))
    buffer = io.BytesIO()
    drawing.save(buffer)
    drawing.close()
    return buffer.getvalue()
