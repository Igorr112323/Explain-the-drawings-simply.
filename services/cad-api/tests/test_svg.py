from __future__ import annotations

import xml.etree.ElementTree as ET

import trimesh

from app.config import COLOR_ACTIVE_FILL, COLOR_ACTIVE_LINE, COLOR_ATTENTION, COLOR_INK
from app.ikea_svg import render_assembly_svg
from app.loader import load_model
from app.sequencer import sequence_assembly
from tests import synthetic

SVG_NS = "{http://www.w3.org/2000/svg}"


def parts():
    loaded = load_model("unit.glb", synthetic.glb_bytes())
    result = sequence_assembly(loaded.parts)
    return loaded.parts, result.steps


def test_svg_is_valid_xml_with_a_viewbox():
    model, steps = parts()
    step = steps[-1]
    installed = [part_id for previous in steps[:-1] for part_id in previous.part_ids]
    result = render_assembly_svg(
        model,
        active_ids=step.part_ids,
        installed_ids=installed,
        azimuth=step.azimuth,
        elevation=step.elevation,
    )
    root = ET.fromstring(result.svg)
    assert root.tag == f"{SVG_NS}svg"
    assert root.attrib["viewBox"] == "0 0 720 520"
    assert root.attrib["role"] == "img"
    assert "<image" not in result.svg  # pure vector, no raster screenshots
    assert result.triangles > 0


def test_exactly_three_semantic_colours():
    model, steps = parts()
    step = steps[-1]
    installed = [part_id for previous in steps[:-1] for part_id in previous.part_ids]
    result = render_assembly_svg(
        model,
        active_ids=step.part_ids,
        installed_ids=installed,
        azimuth=-30,
        elevation=34,
        attention="Затягивайте крест-накрест",
    )
    for colour in (COLOR_ACTIVE_LINE, COLOR_ACTIVE_FILL, COLOR_INK, COLOR_ATTENTION):
        assert colour in result.svg, colour
    # No other saturated palette sneaks in.
    assert "#FF9500" not in result.svg
    assert "#34C759" not in result.svg


def test_attention_callout_is_rendered_in_red():
    model, steps = parts()
    result = render_assembly_svg(
        model,
        active_ids=steps[-1].part_ids,
        installed_ids=[],
        azimuth=-30,
        elevation=34,
        attention="Крест-накрест",
    )
    assert 'class="attention"' in result.svg
    assert "Крест-накрест" in result.svg
    assert f'stroke="{COLOR_ATTENTION}"' in result.svg


def test_active_parts_get_an_axis_and_an_arrow():
    model, steps = parts()
    result = render_assembly_svg(
        model,
        active_ids=steps[-1].part_ids,
        installed_ids=[],
        azimuth=-30,
        elevation=34,
    )
    assert 'class="install-arrow"' in result.svg
    assert 'stroke-dasharray="7 6"' in result.svg  # dashed assembly axis


def test_view_angle_and_explode_change_the_drawing():
    model, steps = parts()
    step = steps[-1]
    first = render_assembly_svg(
        model, active_ids=step.part_ids, installed_ids=[], azimuth=-30, elevation=34
    )
    rotated = render_assembly_svg(
        model, active_ids=step.part_ids, installed_ids=[], azimuth=42, elevation=18
    )
    flushed = render_assembly_svg(
        model, active_ids=step.part_ids, installed_ids=[], azimuth=-30, elevation=34, explode=0.0
    )
    assert first.svg != rotated.svg
    assert first.svg != flushed.svg
    assert 'data-azimuth="42"' in rotated.svg


def test_installed_parts_are_white_and_shaded_alternately():
    model, steps = parts()
    installed = [part_id for previous in steps[:3] for part_id in previous.part_ids]
    result = render_assembly_svg(
        model, active_ids=[], installed_ids=installed, azimuth=35, elevation=26
    )
    assert "#FFFFFF" in result.svg
    assert "#F2F4F7" in result.svg
    assert f'stroke="{COLOR_INK}"' in result.svg


def test_dense_mesh_is_simplified_for_the_diagram():
    from app.models import CadPart

    dense = trimesh.creation.icosphere(subdivisions=4)  # 5120 faces
    part = CadPart(id="part-1", name="Сфера", node_name="sfera", mesh=dense)
    part.refresh_bounds()
    result = render_assembly_svg(
        [part], active_ids=["part-1"], installed_ids=[], azimuth=30, elevation=20
    )
    assert result.reduced is True
    assert result.triangles <= 900


def test_empty_input_produces_a_placeholder_svg():
    result = render_assembly_svg([], active_ids=[], installed_ids=[], azimuth=0, elevation=0)
    ET.fromstring(result.svg)
    assert "Нет геометрии" in result.svg
