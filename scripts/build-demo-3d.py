#!/usr/bin/env python3
"""Generates the built-in 3D demo «Узел привода УП-08».

The script builds a small multi-part assembly with trimesh, runs it through the
real cad-api pipeline (loader -> sequencer) so that part roles, explosion
vectors and step structure are identical to a real import, and writes the result
into a TypeScript module that the studio imports:

    apps/studio-web/src/data/up08-assembly.ts

Everything is procedural: no binary assets are committed, and the studio demo
works with the CAD API stopped.

Usage:
    services/cad-api/.venv/bin/python scripts/build-demo-3d.py
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "cad-api"))

import trimesh  # noqa: E402

from app.loader import load_model  # noqa: E402
from app.sequencer import sequence_assembly  # noqa: E402

OUT = ROOT / "apps" / "studio-web" / "src" / "data" / "up08-assembly.ts"

WALL = 10.0


def box(size, translation):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(translation)
    return mesh


def cylinder(radius, length, translation, axis="y"):
    mesh = trimesh.creation.cylinder(radius=radius, height=length, sections=20)
    if axis == "y":
        mesh.apply_transform(trimesh.transformations.rotation_matrix(-1.5708, [1, 0, 0]))
    mesh.apply_translation(translation)
    return mesh


def housing():
    """Open-top housing: 120 x 80 x 40 with a 10 mm floor and 10 mm walls."""
    floor = box((120, 80, WALL), (0, 0, WALL / 2))
    left = box((WALL, 80, 30), (-55, 0, 25))
    right = box((WALL, 80, 30), (55, 0, 25))
    front = box((100, WALL, 30), (0, -35, 25))
    back = box((100, WALL, 30), (0, 35, 25))
    return trimesh.util.concatenate([floor, left, right, front, back])


def flange():
    """Two bearing bars 40..50 mm high, leaving a channel for the shaft."""
    left = box((20, 60, 10), (-30, 0, 45))
    right = box((20, 60, 10), (30, 0, 45))
    return trimesh.util.concatenate([left, right])


def shaft():
    return cylinder(5.0, 34.0, (0, 0, 44), axis="y")


def cover():
    """Cover plate with four corner pads; bolts screw into the pads."""
    plate = box((60, 40, 8), (0, 0, 54))
    pads = [
        box((20, 20, 8), (x, y, 54))
        for x in (-40, 40)
        for y in (-20, 20)
    ]
    return trimesh.util.concatenate([plate, *pads])


def washer(name):
    return cylinder(6.0, 1.6, (0, 0, 0), axis="z")


def bolt():
    head = cylinder(5.0, 4.0, (0, 0, 2.0), axis="z")
    shank = cylinder(3.0, 6.0, (0, 0, -3.0), axis="z")
    return trimesh.util.concatenate([head, shank])


def build_scene() -> trimesh.Scene:
    parts: list[tuple[str, trimesh.Trimesh]] = [
        ("Корпус", housing()),
        ("Фланец", flange()),
        ("Вал", shaft()),
        ("Крышка", cover()),
    ]
    holes = [(-40, -20), (40, -20), (-40, 20), (40, 20)]
    for index, (x, y) in enumerate(holes, start=1):
        ring = washer("Шайба 6")
        ring.apply_translation((x, y, 58.8))
        parts.append((f"Шайба 6 {index}", ring))
    for index, (x, y) in enumerate(holes, start=1):
        fastener = bolt()
        fastener.apply_translation((x, y, 63.6))
        parts.append((f"Болт М6x20 {index}", fastener))
    return trimesh.Scene(geometry={name: mesh for name, mesh in parts})


def main() -> int:
    scene = build_scene()
    glb = scene.export(file_type="glb")
    glb_bytes = glb if isinstance(glb, bytes) else glb.encode("utf-8")

    loaded = load_model("up08-assembly.glb", glb_bytes)
    steps = sequence_assembly(loaded.parts).steps

    parts = []
    for index, part in enumerate(loaded.parts, start=1):
        step_number = 1
        for step in steps:
            if part.id in step.part_ids:
                step_number = step.number
                break
        parts.append(
            {
                "id": f"part-{index}",
                "nodeName": part.node_name,
                "displayName": part.name,
                "role": part.role,
                "stepNumber": step_number,
                "explosionVector": [round(float(v), 4) for v in part.explosion_vector],
                "volumeMm3": round(float(part.volume_mm3), 2),
                "bboxMm": {
                    "x": round(float(part.size[0]), 3),
                    "y": round(float(part.size[1]), 3),
                    "z": round(float(part.size[2]), 3),
                },
                "center": [round(float(v), 3) for v in part.center],
            }
        )

    step_payload = []
    for step in steps:
        step_payload.append(
            {
                "number": step.number,
                "title": step.title,
                "workerText": step.worker_text,
                "partIds": [
                    f"part-{index + 1}"
                    for index, part in enumerate(loaded.parts)
                    if part.id in step.part_ids
                ],
                "azimuth": step.azimuth,
                "elevation": step.elevation,
                "count": step.count,
                "notation": step.notation,
                "attention": bool(step.attention),
                "attentionText": step.attention,
                "fastenerKey": step.fastener_key,
            }
        )

    data_url = "data:model/gltf-binary;base64," + base64.b64encode(glb_bytes).decode("ascii")

    header = (
        "// AUTO-GENERATED by scripts/build-demo-3d.py — do not edit by hand.\n"
        "// Built-in 3D demo «Узел привода УП-08»: 12 parts, 6 assembly steps.\n"
        "import type { AssemblyPart } from '@ikguide/schema';\n\n"
    )
    body = [
        f"export const UP08_GLB_DATA_URL =\n  '{data_url}';\n",
        "export type DemoAssemblyPart = AssemblyPart & { center: [number, number, number] };\n\n",
        "type RawPart = Omit<DemoAssemblyPart, 'explosionVector' | 'center' | 'role'> & {\n"
        "  explosionVector: number[];\n"
        "  center: number[];\n"
        "  role: string;\n"
        "};\n\n",
        "function demoPart(raw: RawPart): DemoAssemblyPart {\n"
        "  const [x, y, z] = raw.explosionVector;\n"
        "  const [cx, cy, cz] = raw.center;\n"
        "  return {\n"
        "    ...raw,\n"
        "    role: raw.role as AssemblyPart['role'],\n"
        "    explosionVector: [x ?? 0, y ?? 1, z ?? 0],\n"
        "    center: [cx ?? 0, cy ?? 0, cz ?? 0],\n"
        "  };\n"
        "}\n\n",
        "export const UP08_PARTS: DemoAssemblyPart[] = ("
        + json.dumps(parts, ensure_ascii=False, indent=2)
        + ").map(demoPart);\n",
        "export interface DemoCadStep {\n"
        "  number: number;\n"
        "  title: string;\n"
        "  workerText: string;\n"
        "  partIds: string[];\n"
        "  azimuth: number;\n"
        "  elevation: number;\n"
        "  count: number;\n"
        "  notation: string | null;\n"
        "  attention: boolean;\n"
        "  attentionText: string | null;\n"
        "  fastenerKey: string | null;\n"
        "}\n\n",
        "export const UP08_STEPS: DemoCadStep[] = ("
        + json.dumps(step_payload, ensure_ascii=False, indent=2)
        + ").map((step: DemoCadStep) => step);\n",
        "export const UP08_SIZE = { x: 120, y: 80, z: 67 } as const;\n",
        "export const UP08_MASS_KG = 2.18;\n",
    ]
    OUT.write_text(header + "\n".join(body), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(parts)} parts, {len(steps)} steps, {len(glb_bytes) // 1024} KB GLB")
    for step in steps:
        print(f"  {step.number}. {step.title}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
