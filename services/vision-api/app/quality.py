"""Frame quality assessment (brightness, contrast, focus).

The shop-floor UI turns these warnings into a concrete instruction: "переснимите лист".
"""

from __future__ import annotations

import cv2
import numpy as np

from . import config
from .schemas import QualityMetrics, QualityReport

WARNING_LABELS = {
    "too_dark": "Кадр слишком тёмный — включите свет или подойдите к окну.",
    "too_bright": "Кадр пересвечен — уберите лампу или блик из кадра.",
    "too_blurry": "Кадр смазан — держите телефон неподвижно и снимите ещё раз.",
    "low_contrast": "Низкий контраст — протрите лист и избегайте тени от рук.",
    "low_resolution": "Слишком мелкий кадр — снимите ближе или загрузите скан.",
}


def to_gray(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def measure(image: np.ndarray) -> QualityMetrics:
    """Brightness = mean, contrast = standard deviation, focus = variance of Laplacian."""
    gray = to_gray(image)
    if gray.size == 0:
        return QualityMetrics(brightness=0.0, contrast=0.0, sharpness=0.0)

    # Downscale huge scans: Laplacian variance must stay comparable between 12 MP photos and A4 scans.
    height, width = gray.shape[:2]
    longest = max(height, width)
    sample = gray
    if longest > 1600:
        factor = 1600.0 / longest
        sample = cv2.resize(gray, (max(1, int(width * factor)), max(1, int(height * factor))), interpolation=cv2.INTER_AREA)

    return QualityMetrics(
        brightness=round(float(np.mean(sample)), 2),
        contrast=round(float(np.std(sample)), 2),
        sharpness=round(float(cv2.Laplacian(sample, cv2.CV_64F).var()), 2),
    )


def warnings_for(metrics: QualityMetrics, image: np.ndarray) -> list[str]:
    warnings: list[str] = []
    if metrics.brightness < config.DARK_MEAN:
        warnings.append("too_dark")
    if metrics.brightness > config.BRIGHT_MEAN and metrics.contrast < 20.0:
        # A blank, blown-out photo: white paper is normal, a featureless white frame is not.
        warnings.append("too_bright")
    if metrics.contrast < config.LOW_CONTRAST_STD:
        warnings.append("low_contrast")
    if metrics.sharpness < config.BLUR_LAPLACIAN_VARIANCE:
        warnings.append("too_blurry")
    if min(image.shape[:2]) < 500:
        warnings.append("low_resolution")
    return warnings


def assess(image: np.ndarray) -> QualityReport:
    metrics = measure(image)
    return QualityReport(metrics=metrics, warnings=warnings_for(metrics, image))


def describe(warnings: list[str]) -> list[str]:
    """Human readable Russian hints for the API payload."""
    return [WARNING_LABELS[code] for code in warnings if code in WARNING_LABELS]
