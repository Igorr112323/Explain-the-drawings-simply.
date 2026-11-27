"""OCR engines: interface contract, safe fallback and the real pipeline on a clean crop."""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.extractor import TextLine, build_candidates, dedupe_lines, merge_stacked_lines, ocr_lines, ocr_region
from app.layout import Box, detect_layout
from app.ocr import NoopOcrEngine, OcrLine, create_ocr_engine
from synthetic import FONT_BOLD


class FakeEngine:
    """Deterministic stand-in for the real OCR engine: what it reads is exactly what we assert."""

    name = "fake"

    def __init__(self, lines: list[OcrLine]) -> None:
        self._lines = lines
        self.calls: list[tuple[int, int]] = []

    @property
    def version(self) -> str:
        return "0.0-test"

    def recognize(self, image: np.ndarray) -> list[OcrLine]:
        self.calls.append((image.shape[1], image.shape[0]))
        return list(self._lines)


def test_noop_engine_reads_nothing():
    engine = NoopOcrEngine()
    assert engine.recognize(np.zeros((10, 10, 3), dtype=np.uint8)) == []
    assert engine.name == "none"


def test_unknown_engine_falls_back_instead_of_crashing():
    engine, attempted, warnings = create_ocr_engine("does-not-exist")
    assert engine.name == "none"
    assert "does-not-exist" in attempted
    assert "ocr_unavailable" in warnings


def test_ocr_lines_are_mapped_back_from_rotation():
    engine = FakeEngine([OcrLine(text="12", confidence=0.9, box=(40, 10, 20, 16), polygon=[])])
    image = np.full((200, 400, 3), 255, dtype=np.uint8)
    lines = ocr_lines(image, engine, rotations=(90,))
    assert len(lines) == 1
    assert lines[0].rotation == 90
    assert lines[0].box == Box(10, 200 - 1 - (40 + 20), 16, 20)


def test_candidates_from_fake_ocr_are_normalized():
    engine = FakeEngine(
        [
            OcrLine(text="M8-7H", confidence=0.97, box=(100, 100, 120, 28), polygon=[]),
            OcrLine(text="Ra 3.2", confidence=0.95, box=(100, 200, 100, 28), polygon=[]),
        ]
    )
    image = np.full((1200, 1700, 3), 255, dtype=np.uint8)
    lines = ocr_lines(image, engine)
    layout = detect_layout(image)
    candidates = build_candidates(lines, layout, 0)
    texts = {candidate.normalizedText for candidate in candidates}
    assert "М8-7H" in texts
    assert "Ra 3,2" in texts
    for candidate in candidates:
        assert candidate.source == "ocr"


def test_roi_crop_is_upscaled_before_recognition():
    engine = FakeEngine([OcrLine(text="Ø20 H7", confidence=0.9, box=(10, 10, 60, 20), polygon=[])])
    image = np.full((400, 600, 3), 255, dtype=np.uint8)
    lines = ocr_region(image, engine, Box(100, 100, 200, 100), upscale=2.0, rotations=(0,))
    assert lines == [] or lines[0].box.x >= 100
    assert engine.calls and engine.calls[0] == (400, 200)


def test_empty_roi_returns_nothing():
    engine = FakeEngine([OcrLine(text="X", confidence=0.9, box=(0, 0, 4, 4), polygon=[])])
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    assert ocr_region(image, engine, Box(0, 0, 2, 2)) == []
    assert engine.calls == []


def _crop_with_text(text: str, font_size: int = 90) -> np.ndarray:
    canvas = Image.new("RGB", (900, 260), "white")
    draw = ImageDraw.Draw(canvas)
    draw.text((40, 70), text, fill="black", font=ImageFont.truetype(str(FONT_BOLD), font_size))
    return np.array(canvas)[:, :, ::-1].copy()


@pytest.mark.slow
def test_real_engine_reads_a_large_notation(ocr_engine):
    image = _crop_with_text("M8-7H")
    lines = ocr_lines(image, ocr_engine)
    assert lines, "the OCR engine returned no text for a large clean caption"

    layout = detect_layout(np.full((1000, 1200, 3), 255, dtype=np.uint8))
    candidates = build_candidates(merge_stacked_lines(dedupe_lines(lines)), layout, 0)
    assert candidates, "no engineering candidate survived normalization"
    joined = " ".join(candidate.normalizedText for candidate in candidates)
    assert "М8" in joined or "8" in joined
    assert all(candidate.confidence <= 0.99 for candidate in candidates)


@pytest.mark.slow
def test_real_engine_is_honest_about_ambiguous_digits(ocr_engine):
    image = _crop_with_text("12")
    lines = ocr_lines(image, ocr_engine)
    if not lines:
        pytest.skip("engine could not read the synthetic crop")

    layout = detect_layout(np.full((1000, 1200, 3), 255, dtype=np.uint8))
    candidates = [c for c in build_candidates(lines, layout, 0) if any(ch.isdigit() for ch in c.normalizedText)]
    assert candidates
    assert all(candidate.confidence < 0.95 for candidate in candidates)
    assert any(candidate.ambiguousOptions for candidate in candidates)


def test_engine_returns_text_lines_in_upright_coordinates(ocr_engine):
    image = _crop_with_text("Ø20")
    lines = ocr_lines(image, ocr_engine, rotations=(0,))
    if not lines:
        pytest.skip("engine could not read the synthetic crop")
    height, width = image.shape[:2]
    for line in lines:
        assert 0 <= line.box.x < width
        assert 0 <= line.box.y < height
        assert isinstance(line, TextLine)


def test_rapidocr_maps_resized_boxes_back_to_input():
    from concurrent.futures import ThreadPoolExecutor
    from app.ocr import RapidOcrEngine

    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._degraded = False
    engine._max_side = 100
    engine._timeout = 5
    engine._executor = ThreadPoolExecutor(max_workers=1)
    engine._run = lambda image: [OcrLine("Размер", 0.9, (10, 5, 20, 10), [(10, 5), (30, 15)])]
    try:
        result = engine.recognize(np.zeros((200, 400, 3), dtype=np.uint8))
        assert result[0].box == (40, 20, 80, 40)
        assert result[0].polygon == [(40, 20), (120, 60)]
    finally:
        engine._executor.shutdown()


def test_tesseract_russian_required_in_ci():
    import os
    from app.ocr import TesseractOcrEngine
    if not os.environ.get("IKGUIDE_REQUIRE_RUSSIAN_OCR"):
        pytest.skip("Russian Tesseract integration is required in CI")
    engine = TesseractOcrEngine()
    assert engine.name == "tesseract-rus-eng"
    image = _crop_with_text("Деталь 46  Сталь", 72)
    result = " ".join(line.text for line in engine.recognize(image)).lower()
    assert "деталь" in result, result
    assert "сталь" in result, result
    assert "46" in result, result
