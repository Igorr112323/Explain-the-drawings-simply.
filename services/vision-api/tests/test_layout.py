"""ESKD layout: frame, ГОСТ 2.104 stamp and the technical requirements zone."""

from __future__ import annotations

import numpy as np

from app.layout import Box, detect_layout
from synthetic import SheetGeometry, photo_of, render_drawing

geometry = SheetGeometry.for_dpi(150)


def _percent(zone):
    return zone.bboxPercent


def test_stamp_is_found_on_a_clean_sheet(drawing):
    layout = detect_layout(drawing)
    assert layout.frame_detected is True
    assert layout.stamp_detected is True
    assert layout.title_block is not None

    stamp = layout.title_block
    expected = geometry.stamp
    assert stamp.x == np.round(expected[0], -1) + 0 or abs(stamp.x - expected[0]) < 12
    assert abs(stamp.y - expected[1]) < 12
    assert abs(stamp.x2 - expected[2]) < 12
    assert abs(stamp.y2 - expected[3]) < 12


def test_frame_margins_match_gost(drawing):
    layout = detect_layout(drawing)
    frame = layout.frame
    assert frame is not None
    height, width = drawing.shape[:2]
    left_margin = frame.x / width
    other_margins = [frame.y / height, (width - frame.x2) / width, (height - frame.y2) / height]
    assert left_margin > max(other_margins)
    for margin in other_margins:
        assert margin < 0.05


def test_zones_are_reported_in_percent(drawing):
    layout = detect_layout(drawing)
    kinds = {zone.kind for zone in layout.zones()}
    assert {"frame", "drawing", "title_block"} <= kinds

    stamp_zone = next(zone for zone in layout.zones() if zone.kind == "title_block")
    box = _percent(stamp_zone)
    assert 33 < box.x < 39
    assert 68 < box.y < 75
    assert 58 < box.w < 66
    assert 23 < box.h < 29


def test_tech_requirements_sit_right_above_the_stamp(drawing):
    layout = detect_layout(drawing)
    assert layout.tech_req is not None
    assert layout.tech_req.y2 == layout.title_block.y
    assert layout.tech_req.x == layout.title_block.x
    assert layout.tech_req.h > 0.15 * layout.height


def test_region_classification(drawing):
    layout = detect_layout(drawing)
    stamp = layout.title_block
    assert stamp is not None

    center_x = (stamp.x + stamp.w / 2) / layout.width * 100
    center_y = (stamp.y + stamp.h / 2) / layout.height * 100
    assert layout.region_at(center_x, center_y) == "title_block"

    tech = layout.tech_req
    assert tech is not None
    tech_center_y = (tech.y + tech.h / 2) / layout.height * 100
    assert layout.region_at(center_x, tech_center_y) == "tech_req"

    assert layout.region_at(12.0, 12.0) == "field"


def test_blank_sheet_has_no_stamp():
    blank = np.full((1240, 1754, 3), 255, dtype=np.uint8)
    layout = detect_layout(blank)
    assert layout.title_block is None
    assert layout.stamp_detected is False
    assert "stamp_not_found" in layout.warnings
    assert layout.frame is not None


def test_photo_layout_is_detected_after_alignment(photo):
    from app.preprocessing import process_image

    processed = process_image(photo)
    layout = detect_layout(processed.cleaned)
    assert layout.stamp_detected is True
    stamp = layout.to_percent(layout.title_block)
    assert 28 < stamp.x < 42
    assert 64 < stamp.y < 80
    assert stamp.h > 15


def test_box_helpers():
    box = Box(10, 20, 30, 40)
    assert box.x2 == 40
    assert box.y2 == 60


def test_layout_on_resized_sheet():
    small = render_drawing(110)
    layout = detect_layout(small)
    assert layout.stamp_detected is True
    zone = layout.to_percent(layout.title_block)
    assert 30 < zone.x < 42
    assert 65 < zone.y < 78
