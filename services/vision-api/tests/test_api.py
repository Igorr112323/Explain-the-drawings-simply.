"""HTTP contract: /health, /v1/recognize and /v1/recognize/roi."""

from __future__ import annotations

import numpy as np

from synthetic import VECTOR_TEXTS, dark_image, encode_png, photo_of, render_drawing


def _post_files(client, files):
    return client.post(
        "/v1/recognize",
        files=[("files", (name, data, mime)) for name, data, mime in files],
    )


def test_health_reports_engine_and_threshold(client):
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "ikguide-vision-api"
    assert payload["opencv"]
    assert payload["ocr"] in {"rapidocr", "rapidocr-cyrillic", "tesseract-rus-eng", "tesseract-rus-eng+rapidocr", "none"}
    assert payload["confidenceThreshold"] == 0.95
    assert payload["maxPages"] >= 1


def test_root_lists_the_endpoints(client):
    payload = client.get("/").json()
    assert "/v1/recognize" in payload["endpoints"]
    assert "/v1/recognize/roi" in payload["endpoints"]


def test_recognize_vector_pdf(client, vector_pdf):
    response = _post_files(client, [("drawing.pdf", vector_pdf, "application/pdf")])
    assert response.status_code == 200
    payload = response.json()

    assert payload["schemaVersion"] == "1.0"
    assert payload["requestId"].startswith("req-")
    assert len(payload["pages"]) == 1

    page = payload["pages"][0]
    assert page["source"] == "pdf_vector"
    assert page["perspectiveCorrected"] is False
    assert page["imageDataUrl"].startswith("data:image/png;base64,")
    zone_kinds = {zone["kind"] for zone in page["zones"]}
    assert {"frame", "title_block"} <= zone_kinds
    assert "quality" in page and "sharpness" in page["quality"]["metrics"]

    block = payload["titleBlock"]
    assert block["code"] == "КС-04.100.000 СБ"
    assert block["name"] == "Кронштейн"
    assert block["material"] == "09Г2С"
    assert block["scale"] == "1:2"

    normalized = {candidate["normalizedText"] for candidate in payload["candidates"]}
    for text, _position, _size in VECTOR_TEXTS:
        assert text in normalized

    for candidate in payload["candidates"]:
        assert 0 <= candidate["xPercent"] <= 100
        assert 0 <= candidate["yPercent"] <= 100
        assert candidate["confidence"] >= 0.95
        assert candidate["ambiguousOptions"] == []
        assert candidate["region"] in {"field", "title_block", "tech_req"}
        assert candidate["bboxPixels"]["w"] > 0

    assert page["upscale"] == 1.0
    assert payload["bomRows"] == [] and payload["views"] == []

    # Stage-1 compatibility: flat page + annotation list are still present.
    assert payload["page"]["width"] == page["width"]
    assert len(payload["annotations"]) == len(payload["candidates"])
    assert payload["annotations"][0]["kind"] == "other"
    assert all(len(annotation["bbox"]) == 4 for annotation in payload["annotations"])


def test_recognize_reads_the_position_table(client, bom_pdf):
    payload = _post_files(client, [("sheet.pdf", bom_pdf, "application/pdf")]).json()

    rows = payload["bomRows"]
    assert [(row["position"], row["designation"], row["name"], row["quantity"]) for row in rows] == [
        (5, "АБВ.301.12", "Ручка жаровни", 2),
        (6, "АБВ.301.13", "Кронштейн", 1),
        (7, "ГОСТ 7798-70", "Болт М8", 4),
    ]
    for row in rows:
        assert 0 <= row["xPercent"] <= 100 and 0 <= row["yPercent"] <= 100
        assert 0 < row["bboxPercent"]["w"] <= 100
        assert row["pageIndex"] == 0

    views = payload["views"]
    assert [view["name"] for view in views] == ["Спереди", "Сбоку", "Сверху"]
    assert all(view["bboxPercent"]["w"] > 0 for view in views)


def test_recognize_multipage_pdf(client, spec_pdf):
    payload = _post_files(client, [("album.pdf", spec_pdf, "application/pdf")]).json()
    assert len(payload["pages"]) == 2
    assert [page["pageIndex"] for page in payload["pages"]] == [0, 1]
    second = " ".join(candidate["normalizedText"] for candidate in payload["candidates"] if candidate["pageIndex"] == 1)
    assert "Спецификация" in second


def test_recognize_photo_marks_perspective_and_quality(client):
    image = photo_of(render_drawing(140))
    payload = _post_files(client, [("photo.png", encode_png(image), "image/png")]).json()

    page = payload["pages"][0]
    assert page["source"] == "image"
    assert page["perspectiveCorrected"] is True
    assert page["quality"]["metrics"]["brightness"] > 0
    assert "qualityAfter" in page


def test_dark_photo_produces_human_readable_warning(client):
    small = dark_image(render_drawing(110))
    payload = _post_files(client, [("dark.png", encode_png(small), "image/png")]).json()

    page = payload["pages"][0]
    assert "too_dark" in page["warnings"]
    assert any("тёмный" in warning for warning in payload["warnings"])


def test_several_sheets_in_one_request(client, vector_pdf, drawing=None):
    from synthetic import encode_png as encode

    sheet = encode(render_drawing(120))
    payload = _post_files(
        client,
        [
            ("sheet-1.pdf", vector_pdf, "application/pdf"),
            ("sheet-2.png", sheet, "image/png"),
        ],
    ).json()
    assert [page["pageIndex"] for page in payload["pages"]] == [0, 1]
    assert {page["source"] for page in payload["pages"]} == {"pdf_vector", "image"}


def test_roi_on_a_vector_sheet_returns_the_stamp_text(client, vector_pdf):
    payload = _post_files(client, [("drawing.pdf", vector_pdf, "application/pdf")]).json()
    page_id = payload["pages"][0]["pageId"]

    response = client.post(
        "/v1/recognize/roi",
        json={"pageId": page_id, "x": 30, "y": 68, "w": 45, "h": 30},
    )
    assert response.status_code == 200
    roi = response.json()
    assert roi["pageId"] == page_id
    texts = {candidate["normalizedText"] for candidate in roi["candidates"]}
    assert "КС-04.100.000 СБ" in texts
    for candidate in roi["candidates"]:
        assert candidate["confidence"] >= 0.95


def test_roi_unknown_page_is_404(client):
    response = client.post("/v1/recognize/roi", json={"pageId": "pg-does-not-exist", "x": 10, "y": 10, "w": 20, "h": 20})
    assert response.status_code == 404
    assert "Лист не найден" in response.json()["detail"]


def test_roi_rejects_tiny_selection(client):
    response = client.post("/v1/recognize/roi", json={"pageId": "pg-anything", "x": 10, "y": 10, "w": 0.1, "h": 20})
    assert response.status_code == 422


def test_recognize_without_files_is_rejected(client):
    response = client.post("/v1/recognize", files=[])
    assert response.status_code == 400


def test_recognize_unsupported_file_is_rejected(client):
    response = _post_files(client, [("notes.txt", b"definitely not a drawing", "text/plain")])
    assert response.status_code == 422


def test_recognize_too_many_files_is_rejected(client):
    files = [(f"sheet-{index}.png", b"\x89PNG\r\n\x1a\n", "image/png") for index in range(7)]
    response = _post_files(client, files)
    assert response.status_code == 400


def test_blank_image_does_not_crash_the_service(client):
    blank = np.full((700, 1000, 3), 255, dtype=np.uint8)
    response = _post_files(client, [("blank.png", encode_png(blank), "image/png")])
    assert response.status_code == 200
    payload = response.json()
    assert "stamp_not_found" in payload["pages"][0]["warnings"]
    assert any("штамп" in warning.lower() for warning in payload["warnings"])
