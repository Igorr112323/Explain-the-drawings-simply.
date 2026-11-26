"""Document scanner pipeline: decode → perspective rectify → shadow/paper cleanup → PNG preview."""

from __future__ import annotations

import base64
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import config
from .quality import assess
from .schemas import QualityReport


class UnsupportedImageError(ValueError):
    """Raised when bytes cannot be decoded into an image."""


@dataclass
class ProcessedImage:
    cleaned: np.ndarray
    cleaned_gray: np.ndarray
    quality_before: QualityReport
    quality_after: QualityReport
    perspective_corrected: bool
    corners_percent: list[tuple[float, float]] | None = None
    warnings: list[str] = field(default_factory=list)


def _odd(value: float) -> int:
    size = max(3, int(value))
    return size if size % 2 == 1 else size + 1


def decode_image_bytes(data: bytes) -> np.ndarray:
    buffer = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise UnsupportedImageError("Файл не является изображением или повреждён")
    return limit_size(image)


def limit_size(image: np.ndarray, max_side: int = config.MAX_WORKING_SIDE) -> np.ndarray:
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return image
    factor = max_side / longest
    return cv2.resize(image, (max(1, int(width * factor)), max(1, int(height * factor))), interpolation=cv2.INTER_AREA)


def order_points(points: np.ndarray) -> np.ndarray:
    """Returns corners in (top-left, top-right, bottom-right, bottom-left) order."""
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    ordered[0] = points[int(np.argmin(sums))]
    ordered[2] = points[int(np.argmax(sums))]
    ordered[1] = points[int(np.argmin(diffs))]
    ordered[3] = points[int(np.argmax(diffs))]
    return ordered


def find_page_quad(image: np.ndarray) -> np.ndarray | None:
    """Finds the 4-corner paper outline, or None when the sheet is cropped to the frame."""
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    if height < 60 or width < 60:
        return None

    factor = 1200.0 / max(height, width) if max(height, width) > 1200 else 1.0
    sample = cv2.resize(gray, (max(1, int(width * factor)), max(1, int(height * factor))), interpolation=cv2.INTER_AREA)
    blurred = cv2.GaussianBlur(sample, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    sample_area = float(sample.shape[0] * sample.shape[1])
    largest = sorted(contours, key=cv2.contourArea, reverse=True)[:6]
    for contour in largest:
        area = float(cv2.contourArea(contour))
        if area < 0.2 * sample_area:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return approx.reshape(4, 2).astype(np.float32) / factor

    # Soft paper edges (a photo on a table) rarely simplify to exactly four points. For the largest
    # near-rectangular blob the min-area rectangle is a good enough quad: the goal is a straight
    # sheet, not millimetre-perfect corner detection.
    for contour in largest:
        area = float(cv2.contourArea(contour))
        if area < 0.25 * sample_area:
            continue
        rect = cv2.minAreaRect(contour)
        (rect_w, rect_h) = rect[1]
        if min(rect_w, rect_h) < 0.2 * max(rect_w, rect_h):
            continue
        if area < 0.82 * rect_w * rect_h:
            continue  # not a sheet-shaped blob
        points = cv2.boxPoints(rect)
        return points.astype(np.float32) / factor

    return None


def _is_already_straight(quad: np.ndarray, shape: tuple[int, ...]) -> bool:
    height, width = shape[:2]
    quad_area = float(cv2.contourArea(quad))
    if quad_area < 0.965 * width * height:
        return False
    expected = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    return bool(np.all(np.abs(quad - expected) < 0.025 * max(width, height)))


def _corners_percent(quad: np.ndarray, shape: tuple[int, ...]) -> list[tuple[float, float]]:
    height, width = shape[:2]
    return [(round(float(x) / width * 100, 2), round(float(y) / height * 100, 2)) for x, y in quad]


def sheet_fills_frame(gray: np.ndarray, bright: int = 200, fraction: float = 0.9) -> bool:
    """True when the scan is already cropped to the sheet: all four borders are paper-white."""
    height, width = gray.shape[:2]
    margin = max(2, int(min(height, width) * 0.02))
    strips = (
        gray[:margin, :],
        gray[height - margin :, :],
        gray[:, :margin],
        gray[:, width - margin :],
    )
    coverage = float(np.mean([float(np.mean(strip > bright)) for strip in strips]))
    return coverage > fraction


def rectify(image: np.ndarray) -> tuple[np.ndarray, bool, list[tuple[float, float]] | None]:
    """Perspective-corrects the sheet. A sheet that is already straight is passed through."""
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if sheet_fills_frame(gray):
        # Cropped scan: the strongest rectangle here is the ESKD frame, not the paper edge.
        return image, False, None

    quad = find_page_quad(image)
    if quad is None:
        return image, False, None

    points = order_points(quad)
    if _is_already_straight(points, image.shape):
        return image, False, _corners_percent(points, image.shape)

    top = float(np.linalg.norm(points[1] - points[0]))
    bottom = float(np.linalg.norm(points[2] - points[3]))
    left = float(np.linalg.norm(points[3] - points[0]))
    right = float(np.linalg.norm(points[2] - points[1]))
    target_width = int(round(max(top, bottom)))
    target_height = int(round(max(left, right)))

    if target_width < 200 or target_height < 200:
        return image, False, _corners_percent(points, image.shape)

    destination = np.array(
        [[0, 0], [target_width - 1, 0], [target_width - 1, target_height - 1], [0, target_height - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(points, destination)
    warped = cv2.warpPerspective(
        image,
        matrix,
        (target_width, target_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return warped, True, _corners_percent(points, image.shape)


def clean_page(image: np.ndarray) -> np.ndarray:
    """Removes shadows and yellow paper tint, flattens the background and keeps thin lines readable."""
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape[:2]
    if height < 32 or width < 32:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

    # Background estimate: dilate keeps strokes, median removes text so only the paper remains.
    kernel = _odd(min(41, max(5, min(height, width) // 18)))
    dilated = cv2.dilate(gray, np.ones((5, 5), np.uint8), iterations=1)
    background = cv2.medianBlur(dilated, kernel)
    background = np.where(background == 0, 1, background).astype(np.uint8)
    flattened = cv2.divide(gray, background, scale=255)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(flattened)

    low, high = np.percentile(enhanced, (0.5, 99.5))
    scale = 255.0 / max(1.0, float(high - low))
    stretched = np.clip((enhanced.astype(np.float32) - float(low)) * scale, 0, 255).astype(np.uint8)

    # Gentle unsharp mask: enough for OCR, not enough to turn hairlines into noise.
    blurred = cv2.GaussianBlur(stretched, (0, 0), 1.1)
    sharpened = cv2.addWeighted(stretched, 1.3, blurred, -0.3, 0)
    return cv2.cvtColor(sharpened, cv2.COLOR_GRAY2BGR)


def process_image(image: np.ndarray) -> ProcessedImage:
    """Full preprocessing for photos and scans. Layout/OCR always work on the cleaned version."""
    limited = limit_size(image)
    quality_before = assess(limited)
    rectified, corrected, corners = rectify(limited)
    cleaned = clean_page(rectified)
    quality_after = assess(cleaned)

    warnings = list(dict.fromkeys([*quality_before.warnings, *quality_after.warnings]))
    return ProcessedImage(
        cleaned=cleaned,
        cleaned_gray=cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY),
        quality_before=quality_before,
        quality_after=quality_after,
        perspective_corrected=corrected,
        corners_percent=corners,
        warnings=warnings,
    )


def encode_data_url(image: np.ndarray, max_side: int = config.MAX_DATA_URL_SIDE) -> str:
    preview = limit_size(image, max_side)
    success, buffer = cv2.imencode(".png", preview, [int(cv2.IMWRITE_PNG_COMPRESSION), 6])
    if not success:
        raise UnsupportedImageError("Не удалось закодировать очищенный лист в PNG")
    encoded = base64.b64encode(buffer.tobytes()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
