"""OCR artifact normalization and the honesty rules around confidence."""

from __future__ import annotations

import pytest

from app.normalize import (
    ambiguity_options,
    calibrate_confidence,
    looks_like_engineering_text,
    merge_fragments,
    normalize_text,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("M8-7H", "М8-7H"),
        ("M 10x1,25", "М 10×1,25"),
        ("Ø20 H7", "Ø20 H7"),
        ("Ф20 H7", "Ø20 H7"),
        ("O20", "Ø20"),
        ("Ф 16", "Ø16"),
        ("Ø20 Н7", "Ø20 H7"),
        ("Ø20 К5", "Ø20 K5"),
        ("T1-К5", "Т1-К5"),
        ("Ra 3.2", "Ra 3,2"),
        ("4 отв, М8-7H", "4 отв. М8-7H"),
        ("2x45°", "2×45°"),
    ],
)
def test_ocr_artifacts_are_repaired(raw, expected):
    assert normalize_text(raw).text == expected


@pytest.mark.parametrize("raw", ["КС-04.100.000 СБ", "09Г2С", "РД-12.200.000"])
def test_drawing_codes_and_materials_are_untouched(raw):
    result = normalize_text(raw)
    assert result.text == raw
    assert result.applied == []


def test_changes_are_reported():
    result = normalize_text("Ф20 Н7")
    assert "diameter_symbol" in result.applied
    assert "fit_letter" in result.applied


def test_ambiguous_numbers_get_alternative_readings():
    options = ambiguity_options("12", "12")
    assert options[0] == "12"
    assert "18" in options

    options = ambiguity_options("8", "8")
    assert "6" in options

    options = ambiguity_options("Ф20", "Ø20")
    assert "R20" in options


def test_unambiguous_text_has_no_options():
    assert ambiguity_options("Ra 1,6", "Ra 1,6") == ["Ra 1,6"]
    assert ambiguity_options("М10", "М10") == ["М10"]
    assert ambiguity_options("Ø20 H7", "Ø20 H7") == ["Ø20 H7"]


def test_ambiguous_thread_diameter_offers_the_sibling_size():
    options = ambiguity_options("М8-7H", "М8-7H")
    assert options[0] == "М8-7H"
    assert "М6-7H" in options


def test_confidence_for_ambiguous_values_stays_below_threshold():
    normalized = normalize_text("12")
    confidence = calibrate_confidence(0.97, normalized, ambiguous=True)
    assert confidence < 0.95


def test_confidence_penalizes_repairs_and_rotation():
    clean = calibrate_confidence(0.99, normalize_text("Ø20 H7"))
    repaired = calibrate_confidence(0.99, normalize_text("Ф20 Н7"))
    rotated = calibrate_confidence(0.99, normalize_text("Ø20 H7"), rotation=90)
    assert clean == pytest.approx(0.99, abs=1e-3)
    assert repaired < clean
    assert rotated < clean


def test_confidence_is_bounded():
    assert calibrate_confidence(2.0, normalize_text("М8-7H")) <= 0.99
    assert calibrate_confidence(0.0, normalize_text("М8-7H")) >= 0.05


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Ø20 H7", True),
        ("Ra 1,6", True),
        ("4 отв.", True),
        ("███", False),
        ("----", False),
        ("Кронштейн", False),
        ("Сталь 20", True),
    ],
)
def test_engineering_text_filter(text, expected):
    assert looks_like_engineering_text(text) is expected


def test_merge_fragments():
    assert merge_fragments("4 отв.", "М8-7H") == "4 отв. М8-7H"
    assert merge_fragments("Ø20", "H7") == "Ø20H7"
    assert merge_fragments("Ra", "1,6") == "Ra 1,6"
    assert merge_fragments("", "М8") == "М8"


def test_empty_input_is_safe():
    assert normalize_text("").text == ""
    assert ambiguity_options("", "") == []
    assert merge_fragments("", "") == ""
