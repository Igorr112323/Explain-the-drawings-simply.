"""Регрессия по итогам QA-прогона: сервис не должен умирать на мусоре и не должен течь.

Найдено на корпусе `scripts/qa/generate_corpus.py`:
  • изображение 1200×1 роняло нативный OCR (SIGSEGV) — падал весь сервис;
  • кэш страниц «32 штуки / 30 минут» упирался в OOM после ~40 крупных сканов.
"""

from __future__ import annotations

import numpy as np
import pytest
from synthetic import encode_png

from app import config
from app.ocr import RapidOcrEngine, create_ocr_engine
from app.pages import PageStore, pages_from_upload
from app.preprocessing import UnsupportedImageError, process_image, reject_degenerate


def test_ocr_rejects_degenerate_images_without_touching_native_code():
    """Вырожденные картинки не должны доходить до onnxruntime: там SIGSEGV, а не исключение."""
    engine = RapidOcrEngine()
    engine.calls = []  # type: ignore[attr-defined]
    calls: list[object] = []

    def fake_run(prepared):  # перехватываем нативный вызов
        calls.append(prepared)
        return []

    engine._run = fake_run  # type: ignore[assignment]

    for shape in [(1, 1200), (8, 8), (4, 3000), (33, 4000), (900, 12)]:
        image = np.full((shape[0], shape[1], 3), 255, dtype=np.uint8)
        assert engine.recognize(image) == []
    assert calls == [], f"нативный OCR вызван на вырожденной картинке: {calls}"


def test_ocr_still_reads_normal_sheet():
    engine = RapidOcrEngine()
    seen: list[tuple[int, int]] = []

    def fake_run(prepared):
        seen.append((prepared.shape[1], prepared.shape[0]))
        return []

    engine._run = fake_run  # type: ignore[assignment]
    engine.recognize(np.full((600, 800, 3), 255, dtype=np.uint8))
    assert seen, "нормальный лист должен уходить в OCR"


def test_degenerate_sheet_is_reported_not_crashed():
    for array in [
        np.full((1, 1200, 3), 255, dtype=np.uint8),
        np.full((8, 8, 3), 255, dtype=np.uint8),
        np.full((10, 4000, 3), 255, dtype=np.uint8),
    ]:
        with pytest.raises(UnsupportedImageError):
            reject_degenerate(array)
        with pytest.raises(UnsupportedImageError):
            process_image(array)


def test_strip_upload_returns_422_and_keeps_service_alive(client):
    strip = encode_png(np.full((1, 1200, 3), 255, dtype=np.uint8))
    response = client.post("/v1/recognize", files=[("files", ("strip.png", strip, "image/png"))])
    assert response.status_code == 422
    assert "слишком" in response.json()["detail"].lower()
    # сервис обязан остаться живым: следующий запрос обслуживается нормально
    assert client.get("/health").status_code == 200


def test_pages_from_upload_refuses_degenerate_file():
    data = encode_png(np.full((1, 1200, 3), 255, dtype=np.uint8))
    with pytest.raises(Exception) as error:
        pages_from_upload(data, "strip.png", 0)
    assert "маленькое" in str(error.value) or "полоска" in str(error.value)


def _page(width: int, height: int):
    pages = pages_from_upload(
        encode_png(np.full((height, width, 3), 255, dtype=np.uint8)), f"{width}x{height}.png", 0
    )
    return pages[0]


def test_page_store_keeps_memory_budget_not_item_count():
    store = PageStore(ttl=600, max_items=50, max_bytes=3_000_000)
    pages = [_page(600, 900) for _ in range(12)]  # каждая ≈ 1,6 МБ после обработки
    for page in pages:
        store.put(page)
    assert store.stats()["items"] < len(pages)
    assert store.stats()["bytes"] <= 3_000_000


def test_page_store_evicts_oldest_first():
    store = PageStore(ttl=600, max_items=2, max_bytes=1 << 30)
    first, second, third = _page(500, 700), _page(500, 700), _page(500, 700)
    for page in (first, second, third):
        store.put(page)
    assert store.get(first.page_id) is None
    assert store.get(third.page_id) is not None


def test_memory_soft_limit_is_lower_than_typical_crash_point():
    assert config.MEMORY_SOFT_LIMIT_BYTES <= 2 * 1024**3
    assert config.MAX_STORED_BYTES <= 512 * 1024**2
    assert config.MAX_STORED_PAGES <= 12
