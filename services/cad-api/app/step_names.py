"""Reads the product tree of a STEP file from its text, without a CAD kernel.

STEP writers often flatten the assembly (all solids in one compound), so the geometry converter
loses the names. The AP203/AP214 text still contains ``PRODUCT`` and
``NEXT_ASSEMBLY_USAGE_OCCURRENCE`` entities — parsing them keeps «Корпус», «Крышка»,
«Болт М6×20» as part names even when the tessellation is anonymous.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_ENTITY_PATTERN = re.compile(r"#(\d+)\s*=\s*([A-Z_][A-Z0-9_]*)\s*\((.*?)\)\s*;", re.DOTALL)
_MISSING_SEMICOLON = re.compile(r"(?<!;)\n(\s*#\d+\s*=)")
_REF_PATTERN = re.compile(r"#(\d+)")
_QUOTED_PATTERN = re.compile(r"'((?:[^']|'')*)'")

GENERIC_NAME = re.compile(
    r"^(solid|body|part|shell|compound|mesh|object|shape|unnamed|default|result|"
    r"geometry|scene|trimesh|stl|model|assembly|"
    r"ромб|тело|деталь|оболочка|компаунд|сборка|модель)([_\-\s]?\.?\d*)?$",
    re.IGNORECASE,
)


@dataclass
class StepProduct:
    """A product node of the STEP assembly tree."""

    pd_id: str
    name: str
    parent_pd: str | None = None
    quantity: int = 1


@dataclass
class StepTree:
    products: list[StepProduct] = field(default_factory=list)
    unit_scale: float = 1.0
    unit_name: str = "mm"
    assembly_name: str | None = None

    @property
    def names(self) -> list[str]:
        return [product.name for product in self.products]

    def has_names(self) -> bool:
        return any(not is_generic_name(product.name) for product in self.products)


def is_generic_name(name: str) -> bool:
    stripped = (name or "").strip()
    if not stripped:
        return True
    if GENERIC_NAME.match(stripped):
        return True
    # "Solid_1", "Part2", "body.003", bare numbers
    return bool(re.match(r"^[A-Za-zА-Яа-я]*[_.\- ]?\d{1,4}$", stripped))


def _first_quoted(arguments: str) -> str | None:
    match = _QUOTED_PATTERN.search(arguments)
    if not match:
        return None
    value = match.group(1).replace("''", "'").strip()
    return value or None


def _split_args(arguments: str) -> list[str]:
    """Splits a STEP argument list on top-level commas."""
    parts: list[str] = []
    depth = 0
    in_string = False
    current: list[str] = []
    index = 0
    while index < len(arguments):
        char = arguments[index]
        if char == "'":
            in_string = not in_string
            current.append(char)
        elif not in_string and char == "(":
            depth += 1
            current.append(char)
        elif not in_string and char == ")":
            depth -= 1
            current.append(char)
        elif not in_string and depth == 0 and char == ",":
            parts.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        index += 1
    tail = "".join(current).strip()
    if tail:
        parts.append(tail)
    return parts


def _detect_units(text: str) -> tuple[float, str]:
    if re.search(r"CONVERSION_BASED_UNIT\(\s*'INCH'", text, re.IGNORECASE):
        return 25.4, "in"
    if re.search(r"SI_UNIT\(\s*\.MILLI\.\s*,\s*\.METRE\.", text):
        return 1.0, "mm"
    if re.search(r"SI_UNIT\(\s*\$\s*,\s*\.METRE\.", text):
        return 1000.0, "m"
    if re.search(r"SI_UNIT\(\s*\.CENTI\.\s*,\s*\.METRE\.", text):
        return 10.0, "cm"
    return 1.0, "mm"


def parse_step_tree(text: str) -> StepTree:
    """Parses products, product definitions and assembly usage relations from STEP text."""
    # Some exporters omit the semicolon before a new entity; repair that before matching.
    text = _MISSING_SEMICOLON.sub(r";\n\1", text)
    entities: dict[str, tuple[str, str]] = {}
    for number, kind, arguments in _ENTITY_PATTERN.findall(text):
        entities[number] = (kind.upper(), arguments)

    products: dict[str, str] = {}
    formations: dict[str, str] = {}
    definitions: dict[str, str] = {}
    shape_representations: dict[str, str] = {}

    for number, (kind, arguments) in entities.items():
        if kind == "PRODUCT":
            name = _first_quoted(arguments)
            if name:
                products[number] = name
        elif kind.startswith("PRODUCT_DEFINITION_FORMATION"):
            match = _REF_PATTERN.search(arguments.split(",")[-2] if arguments.count(",") >= 1 else "")
            refs = _REF_PATTERN.findall(arguments)
            if refs:
                formations[number] = refs[-1]
        elif kind == "PRODUCT_DEFINITION":
            refs = _REF_PATTERN.findall(arguments)
            if refs:
                definitions[number] = refs[0]
        elif kind == "SHAPE_REPRESENTATION":
            name = _first_quoted(arguments)
            if name:
                shape_representations[number] = name

    # PRODUCT_DEFINITION → PRODUCT name
    definition_names: dict[str, str] = {}
    for pd_id, formation_id in definitions.items():
        product_id = formations.get(formation_id)
        if product_id and product_id in products:
            definition_names[pd_id] = products[product_id]

    # NEXT_ASSEMBLY_USAGE_OCCURRENCE(relating, related) defines the parent-child edge.
    parents: dict[str, str] = {}
    usage_count: dict[str, int] = {}
    relations: list[tuple[str, str]] = []
    for number, (kind, arguments) in entities.items():
        if kind != "NEXT_ASSEMBLY_USAGE_OCCURRENCE":
            continue
        args = _split_args(arguments)
        refs: list[str] = []
        for arg in args:
            refs.extend(_REF_PATTERN.findall(arg))
        if len(refs) >= 2:
            relating, related = refs[0], refs[1]
            relations.append((relating, related))
            parents[related] = relating
            usage_count[related] = usage_count.get(related, 0) + 1

    tree = StepTree(unit_scale=_detect_units(text)[0], unit_name=_detect_units(text)[1])

    # Products that take part in relations; when a file has no relations, list every product.
    relevant = {child for _parent, child in relations} | {parent for parent, _child in relations}
    if not relations:
        relevant = set(definition_names)

    seen: set[str] = set()
    for pd_id, name in definition_names.items():
        if relevant and pd_id not in relevant:
            continue
        if name in {product.name for product in tree.products} and pd_id not in {
            product.pd_id for product in tree.products
        }:
            # Same product name in several instances: keep quantities instead of duplicates.
            continue
        tree.products.append(
            StepProduct(
                pd_id=pd_id,
                name=name,
                parent_pd=parents.get(pd_id),
                quantity=max(1, usage_count.get(pd_id, 1)),
            )
        )
        seen.add(pd_id)

    roots = [product for product in tree.products if product.parent_pd is None]
    if len(roots) == 1:
        tree.assembly_name = roots[0].name
    elif shape_representations:
        tree.assembly_name = next(iter(shape_representations.values()), None)
    return tree


def step_part_names(text: str) -> list[str]:
    """Names of leaf products (the actual parts of the assembly)."""
    tree = parse_step_tree(text)
    if not tree.products:
        return []
    return [product.name for product in tree.products if product.parent_pd is not None] or tree.names
