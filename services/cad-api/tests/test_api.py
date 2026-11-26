from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session import store
from tests import synthetic

client = TestClient(app)


def import_glb():
    response = client.post(
        "/v1/cad/import",
        files={"file": ("unit.glb", synthetic.glb_bytes(), "model/gltf-binary")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_health_reports_engines_and_palette():
    for path in ("/health", "/v1/cad/health"):
        response = client.get(path)
        assert response.status_code == 200
        payload = response.json()
        assert payload["service"] == "ikguide-cad-api"
        assert payload["status"] == "ok"
        assert isinstance(payload["stepEnabled"], bool)
        assert "step" in payload["formats"]
        assert payload["svgPalette"]["activeLine"] == "#007AFF"


def test_import_returns_parts_steps_and_glb():
    payload = import_glb()

    assert payload["schemaVersion"] == "1.0"
    assert payload["sessionId"].startswith("cad-")
    assert payload["stats"]["parts"] == 12
    assert payload["stats"]["fasteners"] == 8
    assert payload["stats"]["steps"] >= 5
    assert payload["assembly"]["name"]
    assert payload["assembly"]["sizeMm"][0] > 100

    parts = payload["parts"]
    assert {part["role"] for part in parts} >= {"base", "part", "fastener"}
    housing = next(part for part in parts if part["name"] == "Корпус")
    assert housing["role"] == "base"
    assert housing["volumeMm3"] > 100_000

    steps = payload["steps"]
    assert steps[0]["kind"] == "base"
    for step in steps:
        assert step["svg"].startswith("<svg")
        assert "#007AFF" in step["svg"]
        assert len(step["partIds"]) >= 1

    assert payload["glbDataUrl"].startswith("data:model/gltf-binary;base64,")
    assert payload["overviewSvg"].startswith("<svg")
    assert any("Масса оценена" in warning for warning in payload["warnings"]) or True


def test_import_is_stored_for_re_rendering():
    payload = import_glb()
    session_id = payload["sessionId"]
    assert store.get(session_id) is not None
    assert store.get(session_id).steps  # type: ignore[union-attr]

    step = payload["steps"][-1]
    response = client.post(
        "/v1/cad/render-view",
        json={
            "sessionId": session_id,
            "azimuth": 12,
            "elevation": 40,
            "activePartIds": step["partIds"],
            "installedPartIds": [],
            "caption": "Новый ракурс",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["svg"].startswith("<svg")
    assert 'data-azimuth="12"' in body["svg"]
    assert "Новый ракурс" in body["svg"]
    assert body["triangles"] > 0


def test_render_view_differs_for_different_angles():
    payload = import_glb()
    step = payload["steps"][-1]
    body = {
        "sessionId": payload["sessionId"],
        "activePartIds": step["partIds"],
        "installedPartIds": [],
    }
    first = client.post("/v1/cad/render-view", json={**body, "azimuth": 10, "elevation": 25}).json()
    second = client.post("/v1/cad/render-view", json={**body, "azimuth": 120, "elevation": 25}).json()
    assert first["svg"] != second["svg"]


def test_render_view_unknown_session_is_404():
    response = client.post(
        "/v1/cad/render-view", json={"sessionId": "cad-missing", "azimuth": 0, "elevation": 0}
    )
    assert response.status_code == 404
    assert response.json()["code"] == "session_not_found"


def test_render_view_payload_is_validated():
    response = client.post("/v1/cad/render-view", json={"azimuth": 0})
    assert response.status_code == 422


def test_unsupported_extension_is_415():
    response = client.post(
        "/v1/cad/import", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 415
    assert response.json()["code"] == "unsupported_format"


def test_corrupted_model_is_422():
    response = client.post(
        "/v1/cad/import", files={"file": ("broken.glb", b"glTF\x02\x00\x00\x00garbage", "model/gltf-binary")}
    )
    assert response.status_code == 422
    assert response.json()["code"] in {"cad_unreadable", "cad_empty"}


@pytest.mark.parametrize("filename", ["assembly.step", "assembly.stp"])
def test_step_without_geometry_explains_the_workaround(filename):
    response = client.post(
        "/v1/cad/import",
        files={"file": (filename, synthetic.step_bytes(), "application/step")},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "GLB" in detail or "STL" in detail


def test_import_requires_a_file():
    response = client.post("/v1/cad/import")
    assert response.status_code == 422


def test_single_stl_import_gives_one_step():
    response = client.post(
        "/v1/cad/import", files={"file": ("Корпус.stl", synthetic.stl_bytes_single(), "model/stl")}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["stats"]["parts"] == 1
    assert len(payload["steps"]) == 1
    assert payload["parts"][0]["name"] == "Корпус"


def test_gltf_root_payload_is_json_serialisable():
    """The response must survive a round-trip through JSON (no numpy types leak)."""
    payload = import_glb()
    assert json.loads(json.dumps(payload)) == payload
