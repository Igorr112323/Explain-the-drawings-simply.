#!/usr/bin/env python3
"""Картинки для установщика NSIS: минимализм вместо серого мастера из 90-х.

Иконка приложения (`icons/*.ico`, `icons/*.png`) здесь не трогается: скрипт рисует только два
изображения страниц установщика.

    python3 scripts/build-installer-images.py

Требуется Pillow. Размеры строгие — NSIS не примет другие:
    nsis-sidebar.bmp  164 × 314, 24-bit BMP (страницы «Приветствие» и «Готово»)
    nsis-header.bmp   150 × 57,  24-bit BMP (шапка страниц «Папка», «Установка», «Готово»)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

INK = (28, 28, 30)
ACCENT = (0, 122, 255)
BG = (255, 255, 255)
DOT = (229, 229, 234)

SIDEBAR = (164, 314)
HEADER = (150, 57)

OUT_DIR = Path(__file__).resolve().parent.parent / "apps" / "desktop-tauri" / "src-tauri" / "nsis"
FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
FONT_REGULAR = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


def font(path: Path, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(path), size)
    except OSError:  # pragma: no cover - шрифт есть в CI и в докере сборки
        return ImageFont.load_default()


def dot_grid(draw: ImageDraw.ImageDraw, size: tuple[int, int], step: int = 12, margin: int = 10) -> None:
    """Тонкая точечная сетка — та же, что на холсте приложения, но едва заметная."""
    width, height = size
    for y in range(margin, height - margin, step):
        for x in range(margin, width - margin, step):
            draw.point((x, y), fill=DOT)


def sidebar() -> Image.Image:
    image = Image.new("RGB", SIDEBAR, BG)
    draw = ImageDraw.Draw(image)
    dot_grid(draw, SIDEBAR)

    # Единственный цветовой акцент — тонкая синяя линия сверху.
    draw.rectangle((16, 24, 84, 26), fill=ACCENT)
    # Подпись внизу: имя продукта и строка «Studio» под ним, без значков и рамок.
    draw.text((16, 232), "IKGuide", font=font(FONT_BOLD, 20), fill=INK)
    draw.text((16, 260), "Studio", font=font(FONT_REGULAR, 11), fill=(130, 130, 136))
    draw.text((16, 276), "2D → PDF", font=font(FONT_REGULAR, 10), fill=ACCENT)
    return image


def header() -> Image.Image:
    image = Image.new("RGB", HEADER, BG)
    draw = ImageDraw.Draw(image)
    # Логотип справа: синий квадрат с белыми буквами, слева — имя продукта. Без рамок и градиентов.
    draw.rounded_rectangle((116, 16, 142, 42), radius=8, fill=ACCENT)
    draw.text((122, 23), "IK", font=font(FONT_BOLD, 11), fill=BG)
    draw.text((18, 23), "IKGuide", font=font(FONT_BOLD, 12), fill=INK)
    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, image in (("nsis-sidebar.bmp", sidebar()), ("nsis-header.bmp", header())):
        # NSIS принимает только 24-битный BMP без сжатия.
        target = OUT_DIR / name
        image.convert("RGB").save(target, format="BMP")
        with Image.open(target) as check:
            print(f"{name}: {check.size[0]}×{check.size[1]}, {check.mode}, {target.stat().st_size} Б")


if __name__ == "__main__":
    main()
