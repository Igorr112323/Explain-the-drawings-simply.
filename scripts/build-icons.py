#!/usr/bin/env python3
"""Draw the IkGuide brand icons — the same plate, assembly node and arrow at every size.

Why a script instead of committed PNGs only: Tauri wants 32/128/256/512 PNGs plus `icon.ico`
(and `icon.icns` on macOS). One source of truth keeps them consistent, and anyone can
regenerate them after a logo tweak.

Usage (Pillow is already in the vision service venv):
    services/vision-api/.venv/bin/python scripts/build-icons.py
    npm run desktop:icons        # same thing, wrapped for convenience
"""

from __future__ import annotations

import pathlib
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - the venv always has Pillow
    sys.exit("Pillow не установлен. Запустите: services/vision-api/.venv/bin/python scripts/build-icons.py")

ROOT = pathlib.Path(__file__).resolve().parent.parent
TAURI_ICONS = ROOT / "apps/desktop-tauri/src-tauri/icons"

ACCENT = (0, 122, 255)
INK = (17, 19, 24)
PAPER = (255, 255, 255)
ACCENT_SOFT = (222, 236, 255)

TAURI_SIZES = {"32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256, "icon.png": 512}


def draw_icon(size: int, *, round_plate: bool = False, transparent_background: bool = True) -> Image.Image:
    """White plate on transparent background with a blue assembly mark inside."""
    scale = 4  # supersampling: crisp diagonals even at 32 px
    canvas = size * scale
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = int(canvas * 0.06)
    radius = int(canvas * 0.22)
    plate_box = (margin, margin, canvas - margin, canvas - margin)

    if round_plate:
        draw.ellipse(plate_box, fill=PAPER if transparent_background else ACCENT_SOFT)
        # A thin accent ring keeps the round icon readable on a dark launcher wallpaper.
        ring = max(2, int(canvas * 0.012))
        draw.ellipse(
            (plate_box[0] + ring, plate_box[1] + ring, plate_box[2] - ring, plate_box[3] - ring),
            outline=ACCENT,
            width=max(2, int(canvas * 0.014)),
        )
    elif transparent_background:
        draw.rounded_rectangle(plate_box, radius=radius, fill=PAPER)
        border = max(2, int(canvas * 0.008))
        draw.rounded_rectangle(plate_box, radius=radius, outline=ACCENT, width=border)
    else:
        draw.rounded_rectangle(plate_box, radius=radius, fill=ACCENT)

    # The mark: two strokes of an isometric assembly (‖ rotated) plus a node and an arrow.
    thickness = max(3, int(canvas * 0.05))
    left = plate_box[0] + int(canvas * 0.24)
    right = plate_box[2] - int(canvas * 0.24)
    top = plate_box[1] + int(canvas * 0.28)
    bottom = plate_box[3] - int(canvas * 0.28)

    gap = int(canvas * 0.085)
    stroke = PAPER if not transparent_background else ACCENT
    draw.line([(left, bottom), (canvas // 2 - gap, top)], fill=stroke, width=thickness)
    draw.line(
        [(canvas // 2 + gap, bottom), (right, top)],
        fill=INK if not transparent_background else ACCENT,
        width=thickness,
    )

    # Assembly node between the strokes.
    node_r = int(canvas * 0.042)
    node_center = (canvas // 2, int(canvas * 0.62))
    draw.ellipse(
        (node_center[0] - node_r, node_center[1] - node_r, node_center[0] + node_r, node_center[1] + node_r),
        fill=INK if not transparent_background else ACCENT,
    )

    # Arrow: «the drawing becomes a step», drawn cheaply but sharply.
    arrow_y = int(canvas * 0.80)
    arrow_x0 = plate_box[0] + int(canvas * 0.26)
    arrow_x1 = plate_box[2] - int(canvas * 0.30)
    arrow_w = max(2, int(canvas * 0.03))
    draw.line([(arrow_x0, arrow_y), (arrow_x1, arrow_y)], fill=ACCENT, width=arrow_w)
    head = int(canvas * 0.055)
    draw.polygon(
        [(arrow_x1 + head, arrow_y), (arrow_x1 - head // 2, arrow_y - head), (arrow_x1 - head // 2, arrow_y + head)],
        fill=ACCENT,
    )

    return image.resize((size, size), Image.LANCZOS)


def save_tauri_icons() -> list[pathlib.Path]:
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    written: list[pathlib.Path] = []
    for name, size in TAURI_SIZES.items():
        path = TAURI_ICONS / name
        draw_icon(size).save(path, format="PNG")
        written.append(path)

    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    base = draw_icon(256)
    path = TAURI_ICONS / "icon.ico"
    base.save(path, format="ICO", sizes=[(s, s) for s in ico_sizes])
    written.append(path)

    # macOS is not a release target, but Tauri's bundler insists on a valid ICNS name.
    icns = TAURI_ICONS / "icon.icns"
    try:
        draw_icon(512).save(icns, format="ICNS")
        written.append(icns)
    except (OSError, ValueError, KeyError):
        print("· ICNS не поддерживается этой сборкой Pillow — файл не создан (Windows/Linux-сборки не используют его).")
    return written


def main() -> int:
    written = save_tauri_icons()
    for path in written:
        print(f"· {path.relative_to(ROOT)}")
    print(f"Готово: {len(written)} файлов иконок.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
