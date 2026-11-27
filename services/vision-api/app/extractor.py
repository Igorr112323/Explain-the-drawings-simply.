"""Text extraction: vector PDF spans (exact coordinates) and OCR of raster sheets.

Branch A: a PDF with a real text layer gives exact boxes, rotation and 0.99 confidence.
Branch B: photos and scans go through OCR in several orientations, then through the
engineering normalizer. Nothing here interprets GOST notation — it only reports what it saw.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np
import pymupdf

from .layout import Box, Layout
from . import config
from .normalize import (
    NormalizedText,
    ambiguity_options,
    calibrate_confidence,
    looks_like_engineering_text,
    merge_fragments,
    normalize_text,
)
from .ocr import OcrEngine
from .schemas import BBoxPercent, Candidate, PixelBox, TitleBlock

Source = Literal["pdf", "ocr"]


@dataclass
class TextLine:
    text: str
    box: Box
    confidence: float
    rotation: int = 0
    source: Source = "ocr"

    @property
    def center(self) -> tuple[float, float]:
        return (self.box.x + self.box.w / 2.0, self.box.y + self.box.h / 2.0)


def _rotate(image: np.ndarray, rotation: int) -> np.ndarray:
    if rotation == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if rotation == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if rotation == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def back_map_box(box: tuple[int, int, int, int], rotation: int, width: int, height: int) -> Box:
    """Maps a box found in a rotated copy back to the original sheet coordinates."""
    x, y, w, h = box
    if rotation == 0:
        return Box(x, y, w, h)
    if rotation == 90:
        # (u, v) in the rotated copy → (x = v, y = H - 1 - u)
        return Box(y, height - 1 - (x + w), h, w)
    if rotation == 180:
        return Box(width - (x + w), height - (y + h), w, h)
    if rotation == 270:
        # (u, v) → (x = W - 1 - v, y = u)
        return Box(width - 1 - (y + h), x, h, w)
    return Box(x, y, w, h)


def extract_vector_lines(page: object, scale: float) -> list[TextLine]:
    """Reads the text layer of a PDF page. `scale` converts PDF points to rendered pixels."""
    lines: list[TextLine] = []
    try:
        raw = page.get_text("dict")  # type: ignore[attr-defined]
    except Exception:
        return lines

    for block in raw.get("blocks", []):
        if block.get("type", 0) != 0 and "lines" not in block:
            continue
        for line in block.get("lines", []):
            spans = [span for span in line.get("spans", []) if str(span.get("text", "")).strip()]
            if not spans:
                continue

            direction = line.get("dir", (1.0, 0.0))
            dx, dy = float(direction[0]), float(direction[1])
            if abs(dy) > 0.5:
                rotation = 90 if dy < 0 else 270  # vertical dimension text
            else:
                rotation = 0  # including upside-down: unreadable in practice

            text = ""
            x0 = y0 = math.inf
            x1 = y1 = -math.inf
            previous_right: float | None = None
            max_height = 0.0
            for span in spans:
                bbox = span.get("bbox", (0, 0, 0, 0))
                span_text = str(span.get("text", ""))
                sx0, sy0, sx1, sy1 = (float(value) * scale for value in bbox)
                span_height = max(1.0, sy1 - sy0)
                max_height = max(max_height, span_height)
                if previous_right is not None:
                    gap = sx0 - previous_right
                    if gap > 0.35 * max_height and not text.endswith(" ") and not span_text.startswith(" "):
                        text += " "
                text += span_text
                previous_right = sx1
                x0, y0, x1, y1 = min(x0, sx0), min(y0, sy0), max(x1, sx1), max(y1, sy1)

            cleaned = re.sub(r"\s+", " ", text).strip()
            if not cleaned:
                continue
            # PyMuPDF text boxes are unrotated even when the rendered page is rotated.
            # Transform the aggregate box before mapping it to raster pixels.
            page_rotation = int(getattr(page, "rotation", 0)) % 360
            if page_rotation:
                rect = pymupdf.Rect(x0 / scale, y0 / scale, x1 / scale, y1 / scale) * page.rotation_matrix
                x0, y0, x1, y1 = (float(value) * scale for value in rect)
                rotation = (rotation + page_rotation) % 360
            width = max(1, int(round(x1 - x0)))
            height = max(1, int(round(y1 - y0)))
            lines.append(
                TextLine(
                    text=cleaned,
                    box=Box(int(round(x0)), int(round(y0)), width, height),
                    confidence=0.99,
                    rotation=rotation,
                    source="pdf",
                )
            )
    return lines


def ocr_lines(image: np.ndarray, engine: OcrEngine, rotations: tuple[int, ...] = (0, 90, 270)) -> list[TextLine]:
    """OCR in several orientations; boxes are mapped back to the upright sheet."""
    height, width = image.shape[:2]
    lines: list[TextLine] = []
    for rotation in rotations:
        rotated = _rotate(image, rotation)
        try:
            recognized = engine.recognize(rotated)
        except Exception:
            continue
        for line in recognized:
            mapped = back_map_box(line.box, rotation, width, height)
            lines.append(
                TextLine(
                    text=line.text.strip(),
                    box=mapped,
                    confidence=line.confidence,
                    rotation=rotation,
                    source="ocr",
                )
            )
    return lines


def ocr_region(
    image: np.ndarray,
    engine: OcrEngine,
    rect: Box,
    upscale: float = config.ROI_UPSCALE,
    rotations: tuple[int, ...] = (0, 90, 270),
) -> list[TextLine]:
    """Re-reads a user-drawn rectangle: crops, upscales and maps boxes back to the sheet."""
    height, width = image.shape[:2]
    x0 = max(0, min(width - 1, rect.x))
    y0 = max(0, min(height - 1, rect.y))
    x1 = max(x0 + 1, min(width, rect.x2))
    y1 = max(y0 + 1, min(height, rect.y2))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return []

    crop = image[y0:y1, x0:x1]
    resized = cv2.resize(crop, None, fx=upscale, fy=upscale, interpolation=cv2.INTER_CUBIC)
    offset_x = x0
    offset_y = y0
    lines = ocr_lines(resized, engine, rotations)
    result: list[TextLine] = []
    for line in lines:
        box = Box(
            offset_x + int(round(line.box.x / upscale)),
            offset_y + int(round(line.box.y / upscale)),
            max(1, int(round(line.box.w / upscale))),
            max(1, int(round(line.box.h / upscale))),
        )
        result.append(TextLine(text=line.text, box=box, confidence=line.confidence, rotation=line.rotation, source=line.source))
    return result


def lines_in_rect(lines: list[TextLine], rect: Box) -> list[TextLine]:
    """Vector lines that fall inside the ROI (exact text layer wins over OCR)."""
    selected: list[TextLine] = []
    for line in lines:
        overlap_w = min(line.box.x2, rect.x2) - max(line.box.x, rect.x)
        overlap_h = min(line.box.y2, rect.y2) - max(line.box.y, rect.y)
        if overlap_w > 0 and overlap_h > 0:
            covered = (overlap_w * overlap_h) / max(1, line.box.w * line.box.h)
            if covered >= 0.4:
                selected.append(line)
    return selected


def _iou(first: Box, second: Box) -> float:
    x0 = max(first.x, second.x)
    y0 = max(first.y, second.y)
    x1 = min(first.x2, second.x2)
    y1 = min(first.y2, second.y2)
    if x1 <= x0 or y1 <= y0:
        return 0.0
    intersection = float((x1 - x0) * (y1 - y0))
    union = float(first.w * first.h + second.w * second.h) - intersection
    return intersection / union if union > 0 else 0.0


def dedupe_lines(lines: list[TextLine]) -> list[TextLine]:
    """Keeps the upright, highest-confidence reading of every visually duplicated line."""
    ordered = sorted(lines, key=lambda line: (line.rotation != 0, -line.confidence, -line.box.w))
    kept: list[TextLine] = []
    for line in ordered:
        duplicate = False
        for existing in kept:
            if _iou(line.box, existing.box) > 0.45:
                duplicate = True
                break
        if not duplicate:
            kept.append(line)
    return kept


def merge_stacked_lines(lines: list[TextLine]) -> list[TextLine]:
    """Merges «4 отв.» + «М8-7H» that a detector splits into two stacked boxes."""
    ordered = sorted(lines, key=lambda line: (line.box.y, line.box.x))
    merged: list[TextLine] = []
    consumed: set[int] = set()

    for index, first in enumerate(ordered):
        if index in consumed:
            continue
        for other_index in range(index + 1, len(ordered)):
            if other_index in consumed:
                continue
            second = ordered[other_index]
            vertical_gap = second.box.y - first.box.y2
            if vertical_gap < 0 or vertical_gap > 0.8 * max(first.box.h, second.box.h):
                continue
            overlap = min(first.box.x2, second.box.x2) - max(first.box.x, second.box.x)
            if overlap < 0.6 * min(first.box.w, second.box.w):
                continue
            combined = merge_fragments(first.text, second.text)
            if not _is_combined_callout(first.text, second.text):
                continue
            x = min(first.box.x, second.box.x)
            y = min(first.box.y, second.box.y)
            w = max(first.box.x2, second.box.x2) - x
            h = max(first.box.y2, second.box.y2) - y
            merged.append(
                TextLine(
                    text=combined,
                    box=Box(x, y, w, h),
                    confidence=min(first.confidence, second.confidence),
                    rotation=0,
                    source=first.source,
                )
            )
            consumed.add(other_index)
            break
        else:
            merged.append(first)
    return merged


CALLOUT_HINT = re.compile(r"(отв|глуб|М\s*\d|Ø|фаск|Ra|Rz)", re.IGNORECASE)
COUNT_PREFIX = re.compile(r"^\d{1,3}\s*(?:отв\.?|отверсти\w*|шт\.?)?$", re.IGNORECASE)
CONTINUATION = re.compile(r"^(?:глуб\.?|глубина|глубиной|±|\d|отв\.?|фаск)", re.IGNORECASE)


def _is_combined_callout(first: str, second: str) -> bool:
    """«4 отв.» above «М8-7H», or «М8-7H» above «глуб. 15» — two boxes, one callout."""
    if len(first) > 16 or len(second) > 24:
        return False
    if COUNT_PREFIX.match(first) and CALLOUT_HINT.search(second):
        return True
    if CALLOUT_HINT.search(first) and CONTINUATION.match(second):
        return True
    return False


def box_to_percent(box: Box, width: int, height: int) -> BBoxPercent:
    return BBoxPercent(
        x=round(box.x / width * 100, 3),
        y=round(box.y / height * 100, 3),
        w=round(box.w / width * 100, 3),
        h=round(box.h / height * 100, 3),
    )


def _region_for(line: TextLine, layout: Layout) -> str:
    cx, cy = line.center
    return layout.region_at(cx / layout.width * 100, cy / layout.height * 100)


def build_candidates(
    lines: list[TextLine],
    layout: Layout,
    page_index: int,
    strict: bool = True,
) -> list[Candidate]:
    """Normalizes every line and produces the candidate list consumed by the TS builder.

    `strict=False` is used for a user-drawn ROI: the operator explicitly pointed at that text, so
    even a line without digits (a part name in the stamp) is returned.
    """
    candidates: list[Candidate] = []
    counter = 0
    for line in sorted(lines, key=lambda item: (item.box.y, item.box.x)):
        normalized: NormalizedText = normalize_text(line.text)
        if not normalized.text:
            continue
        region = _region_for(line, layout)
        letters = len(re.findall(r"[A-Za-zА-Яа-яЁё]", normalized.text))
        if (
            strict
            and region == "field"
            and letters < 8
            and not looks_like_engineering_text(normalized.text)
        ):
            continue
        if region != "field" and len(normalized.text) < 2:
            continue

        # A text layer is exact: no visual ambiguity there. Only OCR gets alternative readings.
        options = ambiguity_options(line.text, normalized.text) if line.source == "ocr" else []
        ambiguous = len(options) > 1
        confidence = calibrate_confidence(
            line.confidence,
            normalized,
            rotation=line.rotation if line.source == "ocr" else 0,
            ambiguous=ambiguous,
            text_height_px=line.box.h if line.source == "ocr" else 0,
        )
        counter += 1
        candidates.append(
            Candidate(
                id=f"p{page_index}-c{counter}",
                pageIndex=page_index,
                rawText=line.text,
                normalizedText=normalized.text,
                xPercent=round(line.center[0] / layout.width * 100, 3),
                yPercent=round(line.center[1] / layout.height * 100, 3),
                bboxPercent=box_to_percent(line.box, layout.width, layout.height),
                bboxPixels=PixelBox(x=max(0, line.box.x), y=max(0, line.box.y), w=line.box.w, h=line.box.h),
                confidence=confidence,
                ambiguousOptions=options if ambiguous else [],
                region=region,  # type: ignore[arg-type]
                source=line.source,
                rotation=line.rotation,
            )
        )
    return candidates


# --- title block (ГОСТ 2.104) -----------------------------------------------------------------

# «КС-04.100.000 СБ»: OCR often glues the «СБ» marker to the code, so it is captured separately.
CODE_PATTERN = re.compile(
    r"\b([А-ЯA-Z]{2,4}[-–]?\d{2,3}(?:[.\-]\d{2,3}){1,3})(?:\s*(СБ|CБ|CB|C6|С6))?(?![\d])"
)
MATERIAL_PATTERN = re.compile(
    r"\b(?:Сталь\s*\d+[А-Яа-я]*|09Г2С|СЧ\s?\d{2}|Ст\s?\d+|12Х18Н10Т|40Х|20Х|45Х|Д16Т|БрОЦС\S*|ЛС59-1|АМг\d)\b"
)
SCALE_PATTERN = re.compile(r"\b(\d{1,3})\s*[:\-]\s*(\d{1,3})\b")
SHEET_PATTERN = re.compile(r"Лист\s*(\d+)", re.IGNORECASE)
TECHNICAL_LINE = re.compile(
    r"^(?:масса|масштаб|литера|лист|листов|формат|разраб|пров|утв|т\.?\s?контр|н\.?\s?контр|материал|поз|обозначение|наименование)\b",
    re.IGNORECASE,
)
LABEL_LINES = re.compile(
    r"^(масса|масштаб|литера|лист|листов|формат|разраб\.?|пров\.?|т\.?\s?контр\.?|н\.?\s?контр\.?|утв\.?|обозначение|наименование|материал|поз\.?)$",
    re.IGNORECASE,
)


def title_block_lines(lines: list[TextLine], layout: Layout) -> list[TextLine]:
    if layout.title_block is None:
        return []
    block = layout.title_block
    selected: list[TextLine] = []
    for line in lines:
        cx, cy = line.center
        if block.x - 2 <= cx <= block.x2 + 2 and block.y - 2 <= cy <= block.y2 + 2:
            selected.append(line)
    return sorted(selected, key=lambda item: (round(item.box.y / max(1, layout.height) * 400), item.box.x))


def _name_candidate(texts: list[str], code: str | None) -> str | None:
    best: str | None = None
    for text in texts:
        stripped = text.strip()
        if len(stripped) < 3 or LABEL_LINES.match(stripped) or TECHNICAL_LINE.match(stripped):
            continue
        if re.search(r"\bкг\b|\bг\.?$", stripped):
            continue
        if code and code in stripped:
            continue
        if SCALE_PATTERN.search(stripped) or MATERIAL_PATTERN.search(stripped):
            continue
        cyrillic = len(re.findall(r"[А-Яа-яЁё]", stripped))
        if cyrillic < 3:
            continue
        if best is None or len(stripped) > len(best):
            best = stripped
    return best


def parse_title_block(lines: list[TextLine], layout: Layout, page_index: int) -> TitleBlock | None:
    """Best-effort metadata of the stamp: name, drawing code, material, scale, sheet."""
    selected = title_block_lines(lines, layout)
    if len(selected) < 2:
        return None

    texts = [line.text for line in selected]
    full = " ".join(texts)

    code_match = CODE_PATTERN.search(full)
    code: str | None = None
    if code_match:
        code = code_match.group(1).replace("–", "-").strip()
        if code_match.group(2):
            code = f"{code} СБ"  # «СБ» is a fixed stamp marker, not a drawing-specific value

    material_match = MATERIAL_PATTERN.search(full)
    material = material_match.group(0).strip() if material_match else None
    if material is None:
        for index, text in enumerate(texts):
            if re.search(r"материал", text, re.IGNORECASE) and index + 1 < len(texts):
                candidate = texts[index + 1].strip()
                if len(candidate) <= 30:
                    material = candidate
                    break

    scale_match = SCALE_PATTERN.search(full)
    scale = f"{scale_match.group(1)}:{scale_match.group(2)}" if scale_match else None

    sheet_match = SHEET_PATTERN.search(full)
    sheet = sheet_match.group(1) if sheet_match else None

    name = _name_candidate(texts, code_match.group(1) if code_match else None)

    source = selected[0].source
    confidence = 0.95 if source == "pdf" else 0.62
    if code is None:
        confidence -= 0.1

    return TitleBlock(
        name=name,
        code=code,
        material=material,
        scale=scale,
        sheet=sheet,
        confidence=round(max(0.1, confidence), 2),
        rawLines=[text for text in texts if len(text) <= 60][:24],
    )


def lines_for_metadata(lines: list[TextLine], layout: Layout) -> list[TextLine]:
    """Lines that belong to the stamp, used for the title-block attempt."""
    return title_block_lines(lines, layout)
