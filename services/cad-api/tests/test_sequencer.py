from __future__ import annotations

from app.loader import load_model
from app.sequencer import (
    DIRECTIONS,
    assembly_order_is_consistent,
    classify_parts,
    sequence_assembly,
)
from tests import synthetic


def load_parts():
    loaded = load_model("unit.glb", synthetic.glb_bytes())
    return loaded.parts


def test_roles_follow_names_and_geometry():
    parts = load_parts()
    classify_parts(parts)
    roles = {part.name: part.role for part in parts}

    assert roles["Корпус"] == "base"
    assert roles["Болт М6x20"] == "fastener"
    assert roles["Шайба 6"] == "fastener"
    assert roles["Крышка"] == "part"
    assert roles["Фланец"] == "part"
    # A shaft is slender but not small: it must stay a regular part.
    assert roles["Вал"] == "part"


def test_sequence_starts_with_the_base_and_ends_with_fasteners():
    parts = load_parts()
    result = sequence_assembly(parts)

    assert [step.number for step in result.steps] == list(range(1, len(result.steps) + 1))
    assert result.steps[0].kind == "base"
    assert result.steps[-1].kind == "fastener"
    assert result.steps[0].part_ids == [next(part.id for part in parts if part.role == "base")]

    kinds = [step.kind for step in result.steps]
    first_fastener = kinds.index("fastener")
    assert all(kind == "fastener" for kind in kinds[first_fastener:])


def test_identical_fasteners_share_one_step():
    parts = load_parts()
    result = sequence_assembly(parts)

    bolt_steps = [step for step in result.steps if step.notation == "М6×20" or "болт" in step.title]
    assert len(bolt_steps) == 1
    bolt_step = bolt_steps[0]
    assert bolt_step.count == 4
    assert bolt_step.title.lower().startswith("закрути 4 болта")
    assert "крест-накрест" in (bolt_step.attention or "").lower()

    washer_steps = [step for step in result.steps if "шайб" in step.title]
    assert len(washer_steps) == 1
    assert washer_steps[0].count == 4
    assert washer_steps[0].title.lower().startswith("надень 4 шайбы")


def test_washers_and_lid_come_before_the_bolts():
    parts = load_parts()
    result = sequence_assembly(parts)
    order = {part_id: step.number for step in result.steps for part_id in step.part_ids}
    lid = next(part.id for part in parts if part.name == "Крышка")
    washer = next(part.id for part in parts if part.name == "Шайба 6")
    bolt = next(part.id for part in parts if part.name == "Болт М6x20")

    assert order[lid] < order[washer] < order[bolt]


def test_every_step_pulls_out_along_a_unit_axis():
    parts = load_parts()
    result = sequence_assembly(parts)
    allowed = {tuple(float(value) for value in vector) for vector in DIRECTIONS}
    for step in result.steps:
        assert tuple(float(value) for value in step.explosion_vector) in allowed
    # The lid and the bolts sit on top, so they are pulled up.
    lid_step = next(step for step in result.steps if "крышк" in step.title)
    assert tuple(lid_step.explosion_vector) == (0.0, 1.0, 0.0)
    bolt_step = next(step for step in result.steps if "болт" in step.title)
    assert tuple(bolt_step.explosion_vector) == (0.0, 1.0, 0.0)


def test_assembly_order_has_no_floating_parts():
    parts = load_parts()
    result = sequence_assembly(parts)
    assert assembly_order_is_consistent(parts, result.steps) is True


def test_single_part_assembly_is_reported():
    loaded = load_model("Корпус.stl", synthetic.stl_bytes_single())
    result = sequence_assembly(loaded.parts)
    assert len(result.steps) == 1
    assert result.steps[0].kind == "base"
    assert any("одна деталь" in warning.lower() for warning in result.warnings)


def test_fastener_plurals_and_cases():
    from app.names import accusative, fastener_verb, pluralize_fastener

    assert pluralize_fastener("Болт М6x20", 4) == "Болта М6x20"
    assert pluralize_fastener("Шайба 6", 4) == "Шайбы 6"
    assert pluralize_fastener("Шайба 6", 21) == "Шайба 6"
    assert accusative("Крышка") == "Крышку"
    assert accusative("Корпус") == "Корпус"
    assert fastener_verb("Шайба 6") == "Надень"
    assert fastener_verb("Болт М6x20") == "Закрути"
