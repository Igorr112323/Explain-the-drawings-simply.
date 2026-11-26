#!/usr/bin/env bash
# ============================================================================
#  IkGuide — локальный бэкенд (Linux / macOS).
#
#  Поднимает два Python-сервиса: распознавание чертежей (:8000) и 3D-модели (:8001).
#  Оба слушают только 127.0.0.1 — наружу ничего не открывается, файлы не покидают
#  компьютер. Студия в браузере обращается к ним через прокси Vite.
#
#    bash scripts/start-backend.sh install   # один раз: два .venv
#    npm run backend                         # обычный запуск
#
#  Для повседневной разработки проще `npm run dev:all`: он поднимает сервисы и UI.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-run}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VISION_PORT="${VISION_PORT:-8000}"
CAD_PORT="${CAD_PORT:-8001}"

install_deps() {
  for service in vision-api cad-api; do
    echo "▸ $service: виртуальное окружение и зависимости"
    if [ ! -x "services/$service/.venv/bin/python" ]; then
      "$PYTHON_BIN" -m venv "services/$service/.venv"
    fi
    "services/$service/.venv/bin/python" -m pip install --upgrade pip >/dev/null
    "services/$service/.venv/bin/python" -m pip install -r "services/$service/requirements.txt"
  done
  echo "✓ Готово. Теперь: npm run backend"
}

case "$MODE" in
  install)
    install_deps
    ;;
  run)
    if [ ! -x "services/vision-api/.venv/bin/python" ] || [ ! -x "services/cad-api/.venv/bin/python" ]; then
      echo "Сначала установите зависимости: bash scripts/start-backend.sh install" >&2
      exit 1
    fi
    cat <<INFO

============================================================
  IkGuide: локальный бэкенд
============================================================
  Распознавание чертежей:  http://127.0.0.1:$VISION_PORT/health
  3D-модели и схемы:       http://127.0.0.1:$CAD_PORT/v1/cad/health

  Остановить: Ctrl+C
INFO

    trap 'kill 0' EXIT INT TERM
    ( cd services/vision-api && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$VISION_PORT" ) &
    ( cd services/cad-api && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$CAD_PORT" ) &
    wait
    ;;
  *)
    echo "Используйте: install | run" >&2
    exit 2
    ;;
esac
