"""Точка входа локального движка распознавания для PyInstaller.

Собирается в `ikguide-vision.exe` в GitHub Actions и кладётся рядом с IKGuide Studio в папку
`engine`. Слушает только 127.0.0.1 — наружу порт не открывается, файлы никуда не уходят.

Отдельно следим за «родителем»: если IKGuide Studio упал или его сняли через диспетчер задач,
`ikguide-vision.exe` не должен остаться висеть в памяти и держать порт 8000. Приложение передаёт
свой PID (`--parent-pid`), а движок тихо завершается, как только родителя не стало.
"""

from __future__ import annotations

import os
import sys
import threading
import time

import uvicorn

from app.main import app

WATCHDOG_INTERVAL_SECONDS = 5.0


def parent_pid_from(argv: list[str]) -> int | None:
    """PID родителя из `--parent-pid N` или из переменной окружения (0/мусор игнорируем)."""
    value: str | None = None
    for index, argument in enumerate(argv):
        if argument == "--parent-pid" and index + 1 < len(argv):
            value = argv[index + 1]
        elif argument.startswith("--parent-pid="):
            value = argument.split("=", 1)[1]
    if value is None:
        value = os.environ.get("IKGUIDE_PARENT_PID")
    if value is None:
        return None
    try:
        pid = int(value)
    except (TypeError, ValueError):
        return None
    return pid if pid > 0 else None


def parent_alive(pid: int) -> bool:
    """Жив ли процесс: на Windows — OpenProcess + WaitForSingleObject, иначе `os.kill(pid, 0)`."""
    if os.name == "nt":  # pragma: no cover - ветка исполняется только на Windows
        import ctypes

        synchronize = 0x00100000
        wait_timeout = 0x00000102
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(pid: int, interval: float = WATCHDOG_INTERVAL_SECONDS, exit_fn=os._exit) -> threading.Thread:
    """Фоновый сторож: как только родителя нет — выходим, не дожидаясь закрытия порта."""

    def loop() -> None:
        while True:
            time.sleep(interval)
            if not parent_alive(pid):
                print(f"ikguide-vision: родительский процесс {pid} завершился — выходим.", file=sys.stderr, flush=True)
                exit_fn(0)
                return

    thread = threading.Thread(target=loop, name="parent-watchdog", daemon=True)
    thread.start()
    return thread


def main() -> None:
    port = int(os.environ.get("VISION_PORT", "8000"))
    pid = parent_pid_from(sys.argv[1:])
    if pid is not None:
        watch_parent(pid)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
