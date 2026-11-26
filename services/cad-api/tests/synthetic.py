"""Programmatic CAD fixtures: no binary files in the repository.

* GLB assemblies are built with trimesh (boxes and cylinders, one node per part);
* STL fixtures are single bodies;
* STEP fixtures contain a real AP214 product structure (PRODUCT / NEXT_ASSEMBLY_USAGE_OCCURRENCE)
  so the text parser can be tested without a CAD kernel.
"""

from __future__ import annotations

import io
import math

import numpy as np
import trimesh


def box(size=(40.0, 30.0, 20.0), translation=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(translation)
    return mesh


def cylinder(radius=3.0, length=20.0, translation=(0.0, 0.0, 0.0)) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=24)
    mesh.apply_translation(translation)
    return mesh


def open_housing() -> trimesh.Trimesh:
    """An open housing: floor plus four walls (no booleans needed, no overlapping bodies)."""
    floor = box((120.0, 80.0, 10.0), (0.0, 0.0, 5.0))
    left = box((10.0, 80.0, 30.0), (-55.0, 0.0, 25.0))
    right = box((10.0, 80.0, 30.0), (55.0, 0.0, 25.0))
    front = box((100.0, 10.0, 30.0), (0.0, -35.0, 25.0))
    back = box((100.0, 10.0, 30.0), (0.0, 35.0, 25.0))
    return trimesh.util.concatenate([floor, left, right, front, back])


def flange_frame() -> trimesh.Trimesh:
    """A square flange frame around the shaft: four lugs, so nothing intersects the shaft."""
    front = box((60.0, 12.0, 10.0), (0.0, -24.0, 45.0))
    back = box((60.0, 12.0, 10.0), (0.0, 24.0, 45.0))
    left = box((12.0, 36.0, 10.0), (-24.0, 0.0, 45.0))
    right = box((12.0, 36.0, 10.0), (24.0, 0.0, 45.0))
    return trimesh.util.concatenate([front, back, left, right])


def make_parts() -> list[tuple[str, trimesh.Trimesh]]:
    """A drive unit: open housing, shaft, flange frame, lid and four M6 bolts with washers.

    Physically consistent stack (Z-up while building; the loader converts to Y-up):
    housing 0…40, shaft 10…60, flange 40…50, lid 60…68, washers 68…69.5, bolts 69.5…89.5.
    """
    parts: list[tuple[str, trimesh.Trimesh]] = [
        ("Корпус", open_housing()),
        ("Вал", cylinder(10.0, 50.0, (0.0, 0.0, 35.0))),
        ("Фланец", flange_frame()),
        ("Крышка", box((120.0, 80.0, 8.0), (0.0, 0.0, 64.0))),
    ]
    for index, (x, y) in enumerate(((45.0, 30.0), (-45.0, 30.0), (45.0, -30.0), (-45.0, -30.0))):
        parts.append((f"Болт М6x20 {index + 1}", cylinder(3.0, 20.0, (x, y, 79.5))))
        parts.append((f"Шайба 6 {index + 1}", cylinder(6.0, 1.5, (x, y, 68.75))))
    return parts


def make_scene(parts=None) -> trimesh.Scene:
    scene = trimesh.Scene()
    for name, mesh in parts or make_parts():
        scene.add_geometry(mesh, geom_name=name, node_name=name, transform=np.eye(4))
    return scene


def glb_bytes(parts=None) -> bytes:
    exported = make_scene(parts).export(file_type="glb")
    return exported if isinstance(exported, bytes) else exported.encode("utf-8")


def stl_bytes_single(size=(50.0, 40.0, 10.0)) -> bytes:
    mesh = box(size)
    exported = mesh.export(file_type="stl")
    return exported if isinstance(exported, bytes) else exported.encode("utf-8")


def obj_bytes_two_parts() -> bytes:
    """Wavefront OBJ with two named groups."""
    first = box((30.0, 30.0, 10.0), (0.0, 0.0, 0.0))
    second = box((10.0, 10.0, 40.0), (20.0, 20.0, 20.0))
    buffer = io.StringIO()
    cursor = 1
    for name, mesh in (("Корпус", first), ("Стойка", second)):
        buffer.write(f"o {name}\n")
        for vertex in mesh.vertices:
            buffer.write(f"v {vertex[0]:.4f} {vertex[1]:.4f} {vertex[2]:.4f}\n")
        for face in mesh.faces:
            buffer.write(f"f {face[0] + cursor} {face[1] + cursor} {face[2] + cursor}\n")
        cursor += len(mesh.vertices)
    return buffer.getvalue().encode("utf-8")


def _step_text(products: list[str], assembly: str, unit_line: str) -> str:
    """AP214 text with a valid product tree: enough for the name parser."""
    lines = [
        "ISO-10303-21;",
        "HEADER;",
        "FILE_DESCRIPTION((''),'2;1');",
        "FILE_NAME('assembly.step','2026-01-01T00:00:00',(''),(''),'ikguide','ikguide','');",
        "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
        "ENDSEC;",
        "DATA;",
        "#1=APPLICATION_CONTEXT('core data for automotive mechanical design processes');",
        "#2=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#1);",
        "#3=PRODUCT_CONTEXT('',#1,'mechanical');",
        "#4=PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');",
        f"#5={unit_line};",
    ]
    index = 6
    assembly_product = index
    lines.append(f"#{index}=PRODUCT('{assembly}','{assembly}','',(#3));")
    index += 1
    assembly_formation = index
    lines.append(f"#{index}=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#{assembly_product},.NOT_KNOWN.);")
    index += 1
    assembly_definition = index
    lines.append(f"#{index}=PRODUCT_DEFINITION('design','',#{assembly_formation},#4);")
    index += 1
    lines.append(f"#{index}=PRODUCT_DEFINITION_SHAPE('','',#{assembly_definition});")
    index += 1

    for position, name in enumerate(products):
        product = index
        lines.append(f"#{index}=PRODUCT('{name}','{name}','',(#3));")
        index += 1
        formation = index
        lines.append(f"#{index}=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#{product},.NOT_KNOWN.);")
        index += 1
        definition = index
        lines.append(f"#{index}=PRODUCT_DEFINITION('design','',#{formation},#4);")
        index += 1
        lines.append(f"#{index}=PRODUCT_DEFINITION_SHAPE('','',#{definition});")
        index += 1
        lines.append(
            f"#{index}=NEXT_ASSEMBLY_USAGE_OCCURRENCE('{name}-usage','',#{assembly_definition},#{definition},$);"
        )
        index += 1

    lines += ["ENDSEC;", "END-ISO-10303-21;"]
    return "\n".join(lines) + "\n"


def step_bytes(products=None, assembly: str = "Узел привода УП-08") -> bytes:
    names = products or ["Корпус", "Крышка", "Болт М6x20", "Шайба 6"]
    return _step_text(names, assembly, "SI_UNIT(.MILLI.,.METRE.)").encode("utf-8")


def step_bytes_metres() -> bytes:
    return _step_text(["Корпус", "Крышка"], "Узел", "SI_UNIT($,.METRE.)").encode("utf-8")


def mask_glb_nodes(glb: bytes, rename: dict[str, str]) -> bytes:
    """Test helper: renames JSON-chunk node names (used to simulate anonymous converters)."""
    text = glb.decode("latin-1")
    for old, new in rename.items():
        text = text.replace(f'"name":"{old}"', f'"name":"{new}"')
    return text.encode("latin-1")


def almost_equal(first: float, second: float, tolerance: float = 1e-6) -> bool:
    return math.isclose(first, second, rel_tol=tolerance, abs_tol=tolerance)
