from __future__ import annotations

import pytest

from app import loader
from app.loader import CadLoadError, detect_format, load_model, pack_glb, step_engine
from app.step_names import is_generic_name, parse_step_tree
from tests import synthetic


def test_glb_assembly_keeps_every_part_name_and_volume():
    loaded = load_model("unit.glb", synthetic.glb_bytes())

    assert len(loaded.parts) == 12
    names = {part.name for part in loaded.parts}
    assert {"Корпус", "Крышка", "Вал", "Фланец", "Болт М6x20", "Шайба 6"} <= names
    # Instance numbers are folded into stable node names instead of ugly display names.
    node_names = {part.node_name for part in loaded.parts}
    assert len(node_names) == 12
    assert {"bolt-m6x20", "bolt-m6x20-2", "shayba-6"} <= node_names

    housing = next(part for part in loaded.parts if part.name == "Корпус")
    # Open housing: floor 120×80×10 + four walls.
    expected = 120.0 * 80.0 * 10.0 + 2 * (10.0 * 80.0 * 30.0) + 2 * (100.0 * 10.0 * 30.0)
    assert housing.volume_mm3 == pytest.approx(expected, rel=0.02)
    assert housing.triangle_count == 60
    assert housing.role == "part"  # roles are assigned by the sequencer, not the loader


def test_assembly_is_centred_and_y_up():
    loaded = load_model("unit.glb", synthetic.glb_bytes())
    minima = min(part.bbox_min[0] for part in loaded.parts)
    maxima = max(part.bbox_max[0] for part in loaded.parts)
    assert minima == pytest.approx(-maxima, abs=0.5)

    shaft = next(part for part in loaded.parts if part.name == "Вал")
    # In CAD files the shaft is vertical along Z; after the Y-up conversion it is vertical along Y.
    assert shaft.size[1] == pytest.approx(50.0, rel=0.05)
    assert shaft.size[0] == pytest.approx(shaft.size[2], rel=0.05)


def test_single_stl_is_named_after_the_file():
    loaded = load_model("Корпус.stl", synthetic.stl_bytes_single())
    assert len(loaded.parts) == 1
    assert loaded.parts[0].name == "Корпус"
    assert loaded.parts[0].volume_mm3 == pytest.approx(50 * 40 * 10, rel=0.02)
    assert loaded.parts[0].node_name == "korpus"


def test_obj_groups_become_parts():
    loaded = load_model("frame.obj", synthetic.obj_bytes_two_parts())
    assert len(loaded.parts) == 2
    assert {part.name for part in loaded.parts} == {"Корпус", "Стойка"}


def test_tiny_mesh_is_rescaled_from_metres():
    tiny = synthetic.box((0.05, 0.04, 0.01))
    data = tiny.export(file_type="stl")
    loaded = load_model("micro.stl", data if isinstance(data, bytes) else data.encode())
    assert loaded.unit_scale == 1000.0
    assert loaded.size_mm[0] == pytest.approx(50.0, rel=0.05)
    assert any("масштаб" in warning for warning in loaded.warnings)


def test_packed_glb_has_stable_node_names():
    loaded = load_model("unit.glb", synthetic.glb_bytes())
    payload = pack_glb(loaded.parts)
    assert payload[:4] == b"glTF"
    text = payload.decode("latin-1")
    for part in loaded.parts:
        assert f'"name":"{part.node_name}"' in text


def test_unknown_extension_is_rejected_with_415():
    with pytest.raises(CadLoadError) as error:
        load_model("notes.txt", b"hello")
    assert error.value.status == 415
    assert error.value.code == "unsupported_format"


def test_corrupted_mesh_is_rejected_with_a_hint():
    with pytest.raises(CadLoadError) as error:
        load_model("broken.glb", b"glTF\x02\x00\x00\x00garbage")
    assert error.value.status == 422
    assert "поврежд" in error.value.message or "прочитать" in error.value.message


def test_format_detection_uses_content_when_the_name_is_wrong():
    assert detect_format("upload.bin", synthetic.glb_bytes()) == "glb"
    assert detect_format("upload.bin", synthetic.stl_bytes_single()) == "stl"
    assert detect_format("upload.bin", synthetic.step_bytes()) == "step"


def test_step_tree_is_parsed_from_text():
    tree = parse_step_tree(synthetic.step_bytes().decode("utf-8"))
    assert tree.assembly_name == "Узел привода УП-08"
    assert {"Корпус", "Крышка", "Болт М6x20", "Шайба 6"} <= set(tree.names)
    assert tree.unit_scale == 1.0
    roots = [product for product in tree.products if product.parent_pd is None]
    assert [root.name for root in roots] == ["Узел привода УП-08"]
    leaves = [product.name for product in tree.products if product.parent_pd is not None]
    assert set(leaves) == {"Корпус", "Крышка", "Болт М6x20", "Шайба 6"}


def test_step_units_are_detected():
    tree = parse_step_tree(synthetic.step_bytes_metres().decode("utf-8"))
    assert tree.unit_scale == 1000.0
    assert tree.unit_name == "m"


def test_generic_names_are_recognised():
    assert is_generic_name("Solid_1")
    assert is_generic_name("Part2")
    assert is_generic_name("тело 1")
    assert not is_generic_name("Крышка")


def test_step_without_geometry_reports_how_to_fix():
    enabled, _engine = step_engine()
    if not enabled:
        pytest.skip("STEP engine is not installed in this environment")
    with pytest.raises(CadLoadError) as error:
        load_model("assembly.step", synthetic.step_bytes())
    assert error.value.code in {"step_empty", "step_engine_failed"}
    assert "GLB" in error.value.message


def test_step_engine_missing_is_explained(monkeypatch):
    monkeypatch.setattr(loader, "cascadio", None)
    with pytest.raises(CadLoadError) as error:
        load_model("assembly.step", synthetic.step_bytes())
    assert error.value.code == "step_engine_missing"
    assert error.value.status == 422
    assert "STL" in error.value.message


def test_step_names_replace_anonymous_converter_nodes(monkeypatch):
    """The converter may return «Solid_1»; the STEP text still has the real product names."""
    anonymous = synthetic.make_scene([("Solid_1", synthetic.box((40.0, 30.0, 20.0))), ("Solid_2", synthetic.box((10.0, 10.0, 5.0), (0.0, 0.0, 25.0)))])
    exported = anonymous.export(file_type="glb")
    glb = exported if isinstance(exported, bytes) else exported.encode()

    class StubEngine:
        __version__ = "stub"

        @staticmethod
        def to_glb_bytes(_data: bytes) -> bytes:
            return glb

    monkeypatch.setattr(loader, "cascadio", StubEngine)
    loaded = load_model("unit.step", synthetic.step_bytes())

    names = {part.name for part in loaded.parts}
    assert names == {"Корпус", "Крышка"}
    assert loaded.source_format == "step"
