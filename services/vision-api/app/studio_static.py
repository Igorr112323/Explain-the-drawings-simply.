"""Раздача собранной веб-студии с цехового сервера — для iPhone и любого браузера.

`.apk` у рабочего уже стоит, а вот у мастера в руках iPhone или старый Android без установки:
навёл штатную камеру на QR → Safari открывает `http://192.168.x.y:8000/?guideId=…` → студия
сама забирает инструкцию с того же сервера и сохраняет её в браузерное хранилище.

Если папки `apps/studio-web/dist` рядом нет, сервис работает как раньше: `/` отдаёт JSON,
и ничего не ломается.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

STUDIO_DIST_ENV = "IKGUIDE_STUDIO_DIST"


def repo_root() -> Path:
    # app/studio_static.py → app → vision-api → services → корень репозитория
    return Path(__file__).resolve().parents[3]


def resolve_studio_dist(explicit: Path | str | None = None) -> Path | None:
    """Возвращает каталог собранной студии или None, если её нет."""

    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(Path(explicit))
    else:
        env = os.environ.get(STUDIO_DIST_ENV, "").strip()
        if env:
            candidates.append(Path(env))
        candidates.append(repo_root() / "apps" / "studio-web" / "dist")
        # Портативная сборка рядом с сервисом (архив цехового сервера).
        candidates.append(Path(__file__).resolve().parents[1] / "studio")

    for candidate in candidates:
        try:
            resolved = candidate.expanduser().resolve()
        except OSError:
            continue
        if (resolved / "index.html").is_file():
            return resolved
    return None


def mount_studio(app: FastAPI, dist: Path) -> bool:
    """Подключает статику студии: `/` (index.html) и `/assets/*`.

    Вызывать **последним**: роуты `/v1/...` и `/health` уже зарегистрированы и имеют приоритет,
    потому что Starlette проверяет маршруты в порядке регистрации.
    """

    index = dist / "index.html"
    if not index.is_file():
        return False

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="studio-assets")

    # Полный каталог доступен по /studio/ — удобно для отладки и для вложенных ассетов
    # (иконки, манифест, service worker), которые Vite кладёт рядом с index.html.
    app.mount("/studio", StaticFiles(directory=str(dist), html=True), name="studio")
    return True
