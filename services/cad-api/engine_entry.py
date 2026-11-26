"""Точка входа локального 3D-движка для PyInstaller.

Собирается в `ikguide-cad.exe` и кладётся рядом с IKGuide Studio в папку `engine`.
Слушает только 127.0.0.1:8001 — так же, как `run.sh dev`.
"""

from __future__ import annotations

import os

import uvicorn

from app.main import app


def main() -> None:
    port = int(os.environ.get("CAD_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
