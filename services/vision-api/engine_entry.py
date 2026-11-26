"""Точка входа локального движка распознавания для PyInstaller.

Собирается в `ikguide-vision.exe` в GitHub Actions и кладётся рядом с IKGuide Studio в папку
`engine`. Слушает только 127.0.0.1 — наружу порт не открывается, файлы никуда не уходят.
"""

from __future__ import annotations

import os

import uvicorn

from app.main import app


def main() -> None:
    port = int(os.environ.get("VISION_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
