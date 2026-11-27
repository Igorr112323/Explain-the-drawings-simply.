"""Sheet cleanup: alignment, shadow removal and frame quality warnings."""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

from app.preprocessing import (
    UnsupportedImageError,
    clean_page,
    decode_image_bytes,
    encode_data_url,
    find_page_quad,
    process_image,
    rectify,
    sheet_fills_frame,
)
from synthetic import blurry_image, dark_image, photo_of, render_drawing


def test_photo_of_sheet_is_rectified_to_a4_landscape(photo):
    processed = process_image(photo)
    assert processed.perspective_corrected is True

    height, width = processed.cleaned.shape[:2]
    aspect = width / height
    assert aspect == pytest.approx(297 / 210, abs=0.06)

    # The sheet keeps a resolution high enough for the stamp and dimension text.
    assert min(height, width) > 900


def test_already_cropped_scan_is_not_warped(drawing):
    processed = process_image(drawing)
    assert processed.perspective_corrected is False
    assert sheet_fills_frame(cv2.cvtColor(drawing, cv2.COLOR_BGR2GRAY)) is True
    assert processed.cleaned.shape[:2] == drawing.shape[:2]


def test_rectify_finds_the_paper_quad(photo):
    quad = find_page_quad(photo)
    assert quad is not None
    area_ratio = cv2.contourArea(quad.astype(np.float32)) / (photo.shape[0] * photo.shape[1])
    assert 0.4 < area_ratio < 0.95

    rectified, corrected, corners = rectify(photo)
    assert corrected is True
    assert corners is not None and len(corners) == 4
    assert rectified.shape[0] < photo.shape[0]


def _halves_difference(gray: np.ndarray, margin: float = 0.1) -> float:
    height, width = gray.shape[:2]
    inset_y, inset_x = int(height * margin), int(width * margin)
    interior = gray[inset_y : height - inset_y, inset_x : width - inset_x]
    left = float(np.mean(interior[:, : interior.shape[1] // 2]))
    right = float(np.mean(interior[:, interior.shape[1] // 2 :]))
    return abs(left - right)


def test_shadow_removal_flattens_the_background(photo):
    warped, corrected, _corners = rectify(photo)
    assert corrected is True

    before = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    after = cv2.cvtColor(clean_page(warped), cv2.COLOR_BGR2GRAY)

    # The synthetic shadow is much stronger on the right; cleanup must flatten the sheet.
    assert _halves_difference(before) > 25.0
    assert _halves_difference(after) < 0.35 * _halves_difference(before)
    assert _halves_difference(after) < 10.0


def test_clean_page_keeps_thin_lines(drawing):
    cleaned = clean_page(drawing)
    gray_original = cv2.cvtColor(drawing, cv2.COLOR_BGR2GRAY)
    gray_clean = cv2.cvtColor(cleaned, cv2.COLOR_BGR2GRAY)
    ink_before = float(np.mean(gray_original < 128))
    ink_clean = float(np.mean(gray_clean < 128))
    assert ink_clean > 0.4 * ink_before
    assert ink_clean < 3.0 * ink_before


def test_dark_photo_is_reported(drawing):
    processed = process_image(dark_image(drawing))
    assert "too_dark" in processed.warnings
    assert processed.quality_before.metrics.brightness < 95


def test_blurry_photo_is_reported(drawing):
    processed = process_image(blurry_image(drawing))
    assert "too_blurry" in processed.warnings
    assert processed.quality_before.metrics.sharpness < 90


def test_low_contrast_photo_is_reported():
    flat = np.full((900, 1400, 3), 140, dtype=np.uint8)
    cv2.putText(flat, "Kronshtein", (80, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (150, 150, 150), 2, cv2.LINE_AA)
    processed = process_image(flat)
    assert "low_contrast" in processed.warnings


def test_clean_scan_has_no_quality_warnings(drawing):
    processed = process_image(drawing)
    assert processed.warnings == []


def test_data_url_is_a_decodable_png(drawing):
    url = encode_data_url(drawing, max_side=600)
    assert url.startswith("data:image/png;base64,")
    payload = base64.b64decode(url.split(",", 1)[1])
    image = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
    assert image is not None
    assert max(image.shape[:2]) <= 600


def test_undecodable_bytes_are_rejected():
    with pytest.raises(UnsupportedImageError):
        decode_image_bytes(b"this is definitely not an image")


def test_photo_quality_is_measured_before_and_after(photo):
    processed = process_image(photo)
    assert processed.quality_before.metrics.sharpness > 0
    # After cleanup the sheet is bright and even, so no quality warning should remain.
    assert processed.quality_after.metrics.brightness > 170
    assert processed.warnings == []


def test_rectified_photo_of_a_tilted_sheet(photo):
    """A second, stronger tilt still ends up with a straight sheet."""
    steeper = photo_of(render_drawing(140), angle=12.0)
    processed = process_image(steeper)
    assert processed.perspective_corrected is True
    height, width = processed.cleaned.shape[:2]
    assert width / height == pytest.approx(297 / 210, abs=0.09)
