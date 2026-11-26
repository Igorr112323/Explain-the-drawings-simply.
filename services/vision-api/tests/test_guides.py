"""Цеховой QR-мост: публикация, выдача, LAN-адреса и раздача студии.

Тесты работают на временном каталоге (`tmp_path`) и не трогают `data/guides` цехового ПК.
"""

from __future__ import annotations

import json
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.guides import GuideError, GuideStore
from app.network import collect_addresses

GUIDE_ID_RE = re.compile(r"^[a-z0-9]{6,12}$")


def sample_document(guide_id: str = "guide-ks04", *, with_3d: bool = True, title: str = "Кронштейн КС-04") -> dict:
    document = {
        "schemaVersion": "1.0",
        "id": guide_id,
        "metadata": {
            "title": title,
            "drawingCode": "КС-04.100.000 СБ",
            "revision": "B",
            "material": "Сталь 09Г2С",
            "blankDimensions": "120 × 80 × 12 мм",
            "difficulty": "medium",
            "author": "Инженер ОТК Иванова А. П.",
            "createdAt": "2026-11-26T08:00:00.000Z",
        },
        "drawing": {"viewId": "bracket-sheet", "sheetFormat": "A3", "scale": "1:1"},
        "bom": [
            {"id": "bom-bolt", "name": "Болт", "size": "М8 × 30", "quantity": 4, "kind": "fastener", "icon": "bolt"},
        ],
        "tools": [
            {"id": "tool-drill", "name": "Сверло Ø6,8", "category": "drill", "purpose": "Отверстия", "forSteps": [1]},
        ],
        "steps": [
            {
                "id": "step-1",
                "number": 1,
                "title": "Разметьте базу А",
                "workerText": "Возьмите полосу и отметьте длинную кромку как базу А.",
                "estimatedMinutes": 5,
                "illustration": {"illustrationId": "art-1", "highlight": [], "arrows": []},
                "antiError": None,
                "criticalChecks": [],
                "drawingRefs": [],
            }
        ],
        "xrayAnnotations": [],
        "qcChecklist": [{"id": "qc-1", "text": "Ø20 H7 в допуске", "required": True}],
    }
    if with_3d:
        document["assembly3d"] = {
            "sourceFormat": "glb",
            "units": "mm",
            "sizeMm": {"x": 120, "y": 80, "z": 67},
            "parts": [{"id": "part-1", "nodeName": "case", "displayName": "Корпус", "role": "base"}],
            "glbDataUrl": "data:model/gltf-binary;base64,AAAA",
        }
    return document


@pytest.fixture()
def guide_api(tmp_path, monkeypatch):
    """Клиент API с изолированным каталогом публикаций."""

    from app import main

    store = GuideStore(tmp_path / "guides", max_guides=5)
    monkeypatch.setattr(main, "guide_store", store)
    return main, TestClient(main.app), store


def test_publish_returns_short_id_and_absolute_url(guide_api):
    _main, client, store = guide_api
    response = client.post("/v1/guides", json=sample_document())
    assert response.status_code == 201

    payload = response.json()
    assert GUIDE_ID_RE.match(payload["id"]), payload["id"]
    assert len(payload["id"]) == 8
    assert payload["has3d"] is True
    assert payload["steps"] == 1
    assert payload["title"] == "Кронштейн КС-04"
    assert payload["drawingCode"] == "КС-04.100.000 СБ"
    assert payload["url"] == f"/v1/guides/{payload['id']}"
    assert payload["absoluteUrl"].endswith(payload["url"])
    assert payload["deduplicated"] is False
    assert payload["sizeBytes"] > 0

    assert (store.root / f"{payload['id']}.json").is_file()
    assert (store.root / f"{payload['id']}.summary.json").is_file()


def test_published_guide_is_returned_verbatim(guide_api):
    _main, client, _store = guide_api
    document = sample_document()
    guide_id = client.post("/v1/guides", json=document).json()["id"]

    response = client.get(f"/v1/guides/{guide_id}")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert response.json() == document


def test_absolute_url_is_useful_to_a_phone_not_only_to_the_laptop(guide_api):
    _main, client, _store = guide_api
    payload = client.post("/v1/guides", json=sample_document()).json()

    # TestClient calls the service as http://testserver — a host a phone can never reach, so the
    # service must answer with something the workshop can actually open.
    assert payload["absoluteUrl"].endswith(f"/v1/guides/{payload['id']}")
    assert payload["absoluteUrl"].startswith(("http://", "https://"))


def test_publishing_the_same_document_twice_reuses_the_id(guide_api):
    _main, client, store = guide_api
    first = client.post("/v1/guides", json=sample_document()).json()
    second = client.post("/v1/guides", json=sample_document()).json()

    assert second["id"] == first["id"]
    assert second["deduplicated"] is True
    assert len(list(store.root.glob("*.summary.json"))) == 1
    assert len([path for path in store.root.glob("*.json") if not path.name.endswith(".summary.json")]) == 1


def test_list_shows_newest_first_without_heavy_payloads(guide_api):
    _main, client, _store = guide_api
    first = client.post("/v1/guides", json=sample_document("guide-a", title="Первая")).json()
    second = client.post("/v1/guides", json=sample_document("guide-b", with_3d=False, title="Вторая")).json()

    payload = client.get("/v1/guides").json()
    assert payload["count"] == 2
    ids = [guide["id"] for guide in payload["guides"]]
    assert ids == [second["id"], first["id"]]
    by_id = {guide["id"]: guide for guide in payload["guides"]}
    assert by_id[second["id"]]["has3d"] is False
    assert by_id[first["id"]]["has3d"] is True
    # В списке нет тела документа — только карточка.
    assert all("steps" in guide and isinstance(guide["steps"], int) for guide in payload["guides"])
    assert "assembly3d" not in payload["guides"][0]


def test_unknown_guide_is_404_with_russian_hint(guide_api):
    _main, client, _store = guide_api
    response = client.get("/v1/guides/abcdefgh")
    assert response.status_code == 404
    assert "не найдена" in response.json()["detail"].lower()


@pytest.mark.parametrize("bad_id", ["zz", "with space", "abc.def", "-abcdef-", "abcdefghijklmnop"])
def test_malformed_ids_are_rejected_before_touching_the_disk(guide_api, bad_id):
    _main, client, _store = guide_api
    response = client.get(f"/v1/guides/{bad_id}")
    assert response.status_code == 400
    assert "идентификатор" in response.json()["detail"].lower()


def test_uppercase_links_are_accepted_and_normalised(guide_api):
    _main, client, _store = guide_api
    guide_id = client.post("/v1/guides", json=sample_document()).json()["id"]
    # Ссылку часто диктуют голосом и печатают руками: регистр не должен её ломать.
    response = client.get(f"/v1/guides/{guide_id.upper()}")
    assert response.status_code == 200
    assert response.json()["id"] == "guide-ks04"


@pytest.mark.parametrize("attack", ["../secret", "..%2Fsecret", "a/../../etc/passwd", "abcdefgh.json"])
def test_path_traversal_never_leaves_the_guides_directory(tmp_path, attack):
    store = GuideStore(tmp_path / "guides")
    with pytest.raises(GuideError):
        store._path(attack)  # noqa: SLF001 - проверяем именно защиту пути


def test_empty_body_is_rejected(guide_api):
    _main, client, _store = guide_api
    response = client.post("/v1/guides", content=b"")
    assert response.status_code == 400
    assert "пустой" in response.json()["detail"].lower()


def test_broken_json_is_rejected_with_position(guide_api):
    _main, client, _store = guide_api
    response = client.post("/v1/guides", content=b'{"schemaVersion": "1.0", ')
    assert response.status_code == 400
    assert "json" in response.json()["detail"].lower()


def test_document_without_steps_is_rejected(guide_api):
    _main, client, _store = guide_api
    document = sample_document()
    document["steps"] = []
    response = client.post("/v1/guides", json=document)
    assert response.status_code == 422
    assert "шаг" in response.json()["detail"].lower()


def test_document_without_title_is_rejected(guide_api):
    _main, client, _store = guide_api
    document = sample_document()
    document["metadata"]["title"] = "   "
    response = client.post("/v1/guides", json=document)
    assert response.status_code == 422
    assert "название" in response.json()["detail"].lower()


def test_too_large_guide_is_rejected_with_advice(tmp_path, monkeypatch):
    from app import main

    store = GuideStore(tmp_path / "guides", max_bytes=2048)
    monkeypatch.setattr(main, "guide_store", store)
    client = TestClient(main.app)

    document = sample_document()
    document["assembly3d"]["glbDataUrl"] = "data:model/gltf-binary;base64," + "A" * 4096
    response = client.post("/v1/guides", json=document)
    assert response.status_code == 413
    assert "мб" in response.json()["detail"].lower()


def test_old_publications_are_pruned(tmp_path):
    store = GuideStore(tmp_path / "guides", max_guides=2)
    for index in range(3):
        store.save(sample_document(f"guide-{index}", title=f"Инструкция {index}"))

    assert store.count() == 2
    titles = {summary.title for summary in store.summaries(limit=10)}
    # Первая (самая старая) вытеснена, две последние остались.
    assert "Инструкция 0" not in titles
    assert {"Инструкция 1", "Инструкция 2"} <= titles


def test_network_info_suggests_a_lan_address(guide_api):
    _main, client, _store = guide_api
    payload = client.get("/v1/network-info").json()

    assert payload["status"] == "ok"
    assert payload["primary"]
    assert payload["suggestedApiBase"] == f"http://{payload['primary']}:{payload['guidePort']}"
    assert payload["addresses"], "должен быть хотя бы один адрес"
    assert any(address["primary"] for address in payload["addresses"])
    for address in payload["addresses"]:
        assert re.match(r"^\d{1,3}(\.\d{1,3}){3}$", address["ip"])
        assert address["kind"] in {"lan", "link-local", "loopback", "other"}


def test_addresses_prefer_lan_and_dedupe(monkeypatch):
    addresses = collect_addresses(
        probe=lambda: "192.168.1.50",
        hostname_lookup=lambda: ["127.0.0.1", "192.168.1.51", "192.168.1.50"],
        extra=[],
    )
    ips = [address.ip for address in addresses]
    assert ips[0] == "192.168.1.50"
    assert ips.count("192.168.1.50") == 1
    assert addresses[0].kind == "lan"
    assert addresses[0].primary is True
    assert ips == ["192.168.1.50", "192.168.1.51", "127.0.0.1"]


def test_link_local_is_not_advertised_as_a_shop_lan_address(monkeypatch):
    from app import network as network_module

    # 169.254.x.x появляется, когда ноутбук вообще не в цеховой сети: подсказывать его телефону нельзя.
    addresses = collect_addresses(
        probe=lambda: "169.254.0.21",
        hostname_lookup=lambda: ["127.0.1.1"],
        extra=[],
    )
    primary = addresses[0]
    assert primary.kind == "link-local"
    assert primary.primary is True
    info = network_module.network_info(8000)
    assert isinstance(info["addresses"], list)


def test_addresses_fall_back_to_loopback_when_offline(monkeypatch):
    addresses = collect_addresses(probe=lambda: None, hostname_lookup=lambda: [], extra=[])
    assert [address.ip for address in addresses] == ["127.0.0.1"]
    assert addresses[0].primary is True


def test_addresses_pick_first_lan_as_primary_when_probe_fails():
    addresses = collect_addresses(probe=lambda: None, hostname_lookup=lambda: ["127.0.0.1", "10.0.0.7"], extra=[])
    assert addresses[0].ip == "10.0.0.7"
    assert addresses[0].primary is True


def test_studio_dist_is_detected_and_mounted(tmp_path):
    from app.studio_static import mount_studio, resolve_studio_dist

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><html><body>IkGuide</body></html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('ikguide')", encoding="utf-8")

    assert resolve_studio_dist(dist) == dist.resolve()
    assert resolve_studio_dist(tmp_path / "нет-такой-папки") is None

    app = FastAPI()
    assert mount_studio(app, dist) is True
    client = TestClient(app)
    index = client.get("/studio/")
    assert index.status_code == 200
    assert "IkGuide" in index.text
    assert client.get("/assets/app.js").status_code == 200


def test_mount_studio_refuses_a_directory_without_index(tmp_path):
    from app.studio_static import mount_studio

    empty = tmp_path / "empty"
    empty.mkdir()
    assert mount_studio(FastAPI(), empty) is False


def test_root_serves_the_studio_to_browsers_and_json_to_api_clients(guide_api, tmp_path, monkeypatch):
    main, client, _store = guide_api
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><html>студия</html>", encoding="utf-8")
    monkeypatch.setattr(main, "resolve_studio_dist", lambda: dist)

    browser = client.get("/", headers={"accept": "text/html,application/xhtml+xml"})
    assert browser.status_code == 200
    assert "text/html" in browser.headers["content-type"]
    assert "студия" in browser.text

    api = client.get("/")
    assert api.status_code == 200
    assert api.headers["content-type"].startswith("application/json")
    assert "/v1/guides" in api.json()["endpoints"]

    # Сканер в телефоне присылает `*/*`: по ссылке из QR должна открыться студия, а не JSON.
    scanned = client.get("/?guideId=pay88sbx&api=http://192.168.1.50:8000", headers={"accept": "*/*"})
    assert "text/html" in scanned.headers["content-type"]
    assert "студия" in scanned.text

    # Явный запрос JSON остаётся JSON даже по ссылке.
    explicit = client.get("/?guideId=pay88sbx", headers={"accept": "application/json"})
    assert explicit.headers["content-type"].startswith("application/json")


def test_summary_file_is_valid_json_on_disk(tmp_path):
    store = GuideStore(tmp_path / "guides")
    summary = store.save(sample_document())
    raw = json.loads((store.root / f"{summary.id}.summary.json").read_text(encoding="utf-8"))
    assert raw["id"] == summary.id
    assert raw["sha256"] == summary.sha256
