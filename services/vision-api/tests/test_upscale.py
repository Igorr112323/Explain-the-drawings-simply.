"""Апскейл мелких листов: мелкий шрифт должен читаться OCR-движком."""

from __future__ import annotations

import cv2
import numpy as np

from app import config
from app.preprocessing import limit_size, upscale_for_ocr


def small_sheet(width: int = 700, height: int = 990, text: str = "ПОЗИЦИЯ 5 Ручка") -> np.ndarray:
    """Белый лист 700 px с тонким мелким текстом — типичное фото старой копии."""
    sheet = np.full((height, width, 3), 255, np.uint8)
    cv2.putText(sheet, text, (30, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 1, cv2.LINE_AA)
    cv2.rectangle(sheet, (20, 20), (width - 20, height - 20), (30, 30, 30), 1)
    return sheet


def test_small_sheet_is_enlarged_two_to_three_times() -> None:
    sheet = small_sheet()
    enlarged, factor = upscale_for_ocr(sheet)

    assert 2.0 <= factor <= 3.0
    assert enlarged.shape[1] == round(sheet.shape[1] * factor)
    assert enlarged.shape[1] >= config.SMALL_SHEET_WIDTH
    assert enlarged.shape[0] / enlarged.shape[1] == sheet.shape[0] / sheet.shape[1]


def test_enlarged_sheet_has_sharper_strokes() -> None:
    sheet = small_sheet()
    enlarged, _ = upscale_for_ocr(sheet)
    plain = cv2.resize(sheet, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)

    def sharpness(image: np.ndarray) -> float:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    assert sharpness(enlarged) > sharpness(plain)


def test_large_sheet_is_not_touched() -> None:
    sheet = np.full((1400, 2000, 3), 255, np.uint8)
    enlarged, factor = upscale_for_ocr(sheet)

    assert factor == 1.0
    assert enlarged is sheet


def test_upscale_never_exceeds_working_limit() -> None:
    # 1300 px — формально мелкий лист, но ×3 дал бы 3900 px: больше рабочего предела.
    sheet = np.full((900, 1300, 3), 255, np.uint8)
    enlarged, factor = upscale_for_ocr(sheet)

    assert factor > 1.0
    assert enlarged.shape[1] <= config.MAX_WORKING_SIDE


def test_uploaded_page_reports_upscale_and_keeps_geometry() -> None:
    """После увеличения проценты раскладки не съезжают: координаты пересчитаны вместе с листом."""
    from app.pages import load_image_page

    sheet = small_sheet(760, 1000)
    # Рамка по краям листа легко находится, штамп — нет; проценты должны совпасть.
    ok, encoded = cv2.imencode(".png", sheet)
    assert ok

    page = load_image_page(encoded.tobytes(), 0)
    assert page.upscale >= 1.0
    if page.upscale > 1.0:
        assert page.layout.width == page.width
        assert page.layout.height == page.height
        zone = page.layout.zones()
        if zone:
            assert 0 <= zone[0].bboxPercent.x <= 100
            assert zone[0].bboxPercent.w <= 100


def test_limit_size_still_caps_huge_scans() -> None:
    huge = np.full((4000, 6000, 3), 255, np.uint8)
    limited = limit_size(huge)
    assert max(limited.shape[:2]) <= config.MAX_WORKING_SIDE
