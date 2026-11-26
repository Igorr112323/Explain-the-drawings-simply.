#!/usr/bin/env python3
"""Собирает встроенные шрифты PDF-экспортёра: `packages/pdf-exporter/src/fonts/*.ts`.

Зачем: `.pdf` должен показывать кириллицу, `Ø`, `±`, `°`, `×`, `№` и стрелки **без интернета** и без
надежды на шрифты системы. Поэтому в пакет кладётся урезанный DejaVu Sans (regular + bold) в base64 и
таблица ширин глифов — по ней `layout.ts` переносит строки так же, как это сделает jsPDF.

Шрифт DejaVu Sans распространяется по свободной лицензии Bitstream Vera / Arev (см. `fonts/NOTICE.md`),
встраивание в PDF и перераспространение подмножества разрешены.

Запуск (нужен `fonttools`):

    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools
    /tmp/fontenv/bin/python scripts/build-pdf-fonts.py

По умолчанию берутся системные DejaVu из `/usr/share/fonts/truetype/dejavu/` (пакет `fonts-dejavu-core`
в Debian/Ubuntu). Результат детерминирован: одинаковый входной TTF даёт одинаковые файлы.
"""

from __future__ import annotations

import base64
import json
import textwrap
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "packages" / "pdf-exporter" / "src" / "fonts"
DEFAULT_SOURCES = Path("/usr/share/fonts/truetype/dejavu")

# Латиница, кириллица, типографика, математика и стрелки, которые реально встречаются в инструкциях.
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,"
    "U+2010-2027,U+2030-205E,U+20AC,U+2116,U+2100-214F,"
    "U+2190-21FF,U+2200-22FF,U+2302,U+25A0-25FF,U+2713-2714"
)

FONTS = {
    "regular": ("DejaVuSans.ttf", "DEJAVU_REGULAR", "DejaVuSans"),
    "bold": ("DejaVuSans-Bold.ttf", "DEJAVU_BOLD", "DejaVuSans-Bold"),
}


def subset(source: Path) -> tuple[bytes, dict[str, int], int]:
    font = TTFont(source)
    options = Options()
    options.layout_features = []
    options.hinting = False
    options.desubroutinize = True
    options.drop_tables += ["FFTM"]
    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=parse_unicodes(UNICODES))
    subsetter.subset(font)

    units_per_em = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    widths = {}
    for codepoint, glyph_name in sorted(cmap.items()):
        if 0x20 <= codepoint and codepoint < 0x3000 or 0x0400 <= codepoint <= 0x045F:
            # Сырые единицы шрифта (unitsPerEm на em): деление на unitsPerEm делает `text.ts`.
            widths[chr(codepoint)] = int(hmtx[glyph_name][0])

    tmp = OUT / f".{source.stem}.tmp.ttf"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    font.save(tmp)
    data = tmp.read_bytes()
    tmp.unlink()
    return data, widths, units_per_em


def parse_unicodes(spec: str) -> set[int]:
    result: set[int] = set()
    for chunk in spec.split(","):
        part = chunk.strip().replace("U+", "")
        if "-" in part:
            start, end = part.split("-")
            result.update(range(int(start, 16), int(end, 16) + 1))
        elif part:
            result.add(int(part, 16))
    return result


def wrap_base64(payload: str, width: int = 116) -> str:
    return "\n".join(textwrap.wrap(payload, width))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    metrics: dict[str, dict[str, int]] = {}
    units = 2048
    modules: list[str] = []
    for style, (filename, constant, pdf_name) in FONTS.items():
        source = DEFAULT_SOURCES / filename
        if not source.exists():
            raise SystemExit(f"Не найден {source}: установите fonts-dejavu-core")
        data, widths, units = subset(source)
        metrics[constant] = widths
        payload = base64.b64encode(data).decode("ascii")
        modules.append(
            f"""// Сгенерировано `scripts/build-pdf-fonts.py` из {filename}; не редактировать руками.
// Подмножество DejaVu Sans (лицензия Bitstream Vera / Arev, см. fonts/NOTICE.md).
export const {constant}_NAME = '{pdf_name}';
export const {constant}_SIZE_BYTES = {len(data)};
export const {constant}_BASE64 = '{payload}';
"""
        )
        print(f"{pdf_name}: {len(data) / 1024:.1f} КБ, глифов {len(widths)}")

    (OUT / "dejavu.ts").write_text(
        "\n".join(modules),
        encoding="utf-8",
    )
    lines = [
        "// Сгенерировано `scripts/build-pdf-fonts.py`: ширины глифов DejaVu Sans в единицах шрифта.",
        "// Нужны, чтобы перенос строк в `plan.ts` совпадал с тем, что нарисует jsPDF.",
        f"export const FONT_UNITS_PER_EM = {units};",
        "",
    ]
    for constant in ("DEJAVU_REGULAR", "DEJAVU_BOLD"):
        table = metrics[constant]
        lines.append(
            f"export const GLYPH_WIDTHS_{constant.removeprefix('DEJAVU_')}: Readonly<Record<string, number>> = "
            + json.dumps(table, ensure_ascii=False, sort_keys=True)
            + ";"
        )
        lines.append("")
    (OUT / "metrics.ts").write_text("\n".join(lines), encoding="utf-8")
    print(f"metrics: {len(metrics['DEJAVU_REGULAR'])} символов на начертание")


if __name__ == "__main__":
    main()
