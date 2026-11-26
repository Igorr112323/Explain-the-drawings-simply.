"""ESKD sheet structure: frame, GOST 2.104 title block (stamp) and technical requirements zone.

Only geometry is detected here — no text interpretation. The zones are returned in percent so the
web UI can render them over the cleaned sheet.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .schemas import BBoxPercent, Zone


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int

    @property
    def x2(self) -> int:
        return self.x + self.w

    @property
    def y2(self) -> int:
        return self.y + self.h


@dataclass
class Layout:
    width: int
    height: int
    frame: Box | None = None
    title_block: Box | None = None
    tech_req: Box | None = None
    drawing: Box | None = None
    stamp_detected: bool = False
    frame_detected: bool = False
    warnings: list[str] = field(default_factory=list)

    def zones(self) -> list[Zone]:
        result: list[Zone] = []
        for kind, box in (
            ("frame", self.frame),
            ("drawing", self.drawing),
            ("title_block", self.title_block),
            ("tech_req", self.tech_req),
        ):
            if box is not None:
                result.append(Zone(kind=kind, bboxPercent=self.to_percent(box)))
        return result

    def to_percent(self, box: Box) -> BBoxPercent:
        return BBoxPercent(
            x=round(box.x / self.width * 100, 2),
            y=round(box.y / self.height * 100, 2),
            w=round(box.w / self.width * 100, 2),
            h=round(box.h / self.height * 100, 2),
        )

    def region_at(self, x_percent: float, y_percent: float) -> str:
        def inside(box: Box | None) -> bool:
            if box is None:
                return False
            x = box.x / self.width * 100
            y = box.y / self.height * 100
            return x <= x_percent <= x + box.w / self.width * 100 and y <= y_percent <= y + box.h / self.height * 100

        if inside(self.title_block):
            return "title_block"
        if inside(self.tech_req):
            return "tech_req"
        return "field"


def _line_masks(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    height, width = gray.shape[:2]
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_MEAN_C,
        cv2.THRESH_BINARY_INV,
        25,
        10,
    )
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, width // 35), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, height // 35)))
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=1)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=1)
    return horizontal, vertical


def _contours(mask: np.ndarray) -> list[np.ndarray]:
    # RETR_LIST, not RETR_EXTERNAL: on a rectified photo the sheet's own edge is an outer contour
    # and the drawing frame would otherwise be skipped as "nested".
    found = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    return list(found[0])


# ESKD margins on A4: 20 mm on the left (binding), 5 mm elsewhere. As page fractions that is
# about 6.7 % / 2.4 % for landscape A4; a sheet photographed edge-to-edge otherwise wins by area.
EXPECTED_MARGINS = (0.067, 0.024, 0.017, 0.024)


def _detect_frame(mask: np.ndarray, width: int, height: int) -> Box | None:
    page_area = float(width * height)
    best: Box | None = None
    best_score = float("inf")
    for contour in _contours(mask):
        x, y, w, h = cv2.boundingRect(contour)
        area = float(w * h)
        if area < 0.45 * page_area or area > 0.995 * page_area:
            continue
        if x > 0.12 * width or y > 0.09 * height or (x + w) < 0.88 * width or (y + h) < 0.91 * height:
            continue
        margins = (x / width, y / height, (width - (x + w)) / width, (height - (y + h)) / height)
        score = sum(abs(value - expected) for value, expected in zip(margins, EXPECTED_MARGINS))
        if score < best_score:
            best_score = score
            best = Box(x, y, w, h)
    return best


def _detect_stamp_top(horizontal: np.ndarray, frame: Box, height: int) -> tuple[Box | None, int | None]:
    """The stamp's top border is the longest horizontal line in the lower part of the sheet."""
    frame_bottom = frame.y2
    min_y = frame.y + 0.55 * frame.h
    max_y = frame_bottom - 0.02 * frame.h
    candidates: list[tuple[float, Box]] = []
    for contour in _contours(horizontal):
        x, y, w, h = cv2.boundingRect(contour)
        if h > 8 or w < 0.12 * frame.w:
            continue
        if y < min_y or y > max_y:
            continue
        if w > 0.92 * frame.w:
            continue  # the frame's own bottom border
        if x < frame.x + 0.15 * frame.w:
            continue  # a stamp starts near the middle or further right
        # Prefer long lines that end at the frame's right edge (that is how a stamp is drawn).
        edge_bonus = 1.15 if abs((x + w) - frame.x2) < 0.06 * frame.w else 1.0
        candidates.append((w * edge_bonus, Box(x, y, w, h)))

    if not candidates:
        return None, None

    # Among equally long lines the topmost one is the stamp's outer border: the inner rows are
    # the same width but sit lower, which would cut the stamp in half.
    candidates.sort(key=lambda item: (-round(item[0] / (0.05 * frame.w)), item[1].y))
    score, line = candidates[0]
    if score < 0.18 * frame.w:
        return None, None

    # The stamp's outer top border may be broken by a fold or shadow, while an inner row survives.
    # Walk up through equally wide lines and keep the highest one as the stamp top.
    top = line
    for _candidate_score, other in candidates:
        if abs(other.x - line.x) > 0.04 * frame.w:
            continue
        if not (0.75 * line.w <= other.w <= 1.15 * line.w):
            continue
        if other.y >= top.y or line.y - other.y > 0.4 * frame.h:
            continue
        top = other

    stamp_height = int(min(max(0.09 * height, frame_bottom - top.y), 0.32 * height))
    stamp = Box(top.x, top.y, frame.x2 - top.x, stamp_height)
    return stamp, top.y


def detect_layout(image: np.ndarray) -> Layout:
    """Detects the drawing frame and the title block on a cleaned sheet."""
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    horizontal, vertical = _line_masks(gray)
    grid = cv2.bitwise_or(horizontal, vertical)

    layout = Layout(width=width, height=height)
    frame = _detect_frame(grid, width, height)
    if frame is None:
        frame = Box(int(0.01 * width), int(0.01 * height), int(0.98 * width), int(0.98 * height))
        layout.warnings.append("frame_not_found")
    else:
        layout.frame_detected = True
    layout.frame = frame

    stamp, stamp_top = _detect_stamp_top(horizontal, frame, height)
    if stamp is not None and stamp.y > frame.y + 0.2 * frame.h:
        layout.title_block = stamp
        layout.stamp_detected = True

        tech_height = int(min(0.28 * height, stamp.y - frame.y))
        if tech_height > 0.06 * height:
            layout.tech_req = Box(stamp.x, stamp.y - tech_height, stamp.w, tech_height)

        drawing_bottom = stamp_top if stamp_top is not None else stamp.y
        layout.drawing = Box(frame.x, frame.y, frame.w, max(1, drawing_bottom - frame.y))
    else:
        layout.warnings.append("stamp_not_found")
        layout.drawing = Box(frame.x, frame.y, frame.w, frame.h)

    return layout
