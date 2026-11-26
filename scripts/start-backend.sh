#!/usr/bin/env bash
# ============================================================================
#  IkGuide — локальный бэкенд (Linux / macOS).
#
#  Поднимает Python-сервис распознавания 2D-чертежей (:8000).
#  Он слушает только 127.0.0.1 — наружу ничего не открывается, файлы не покидают
#  компьютер. Студия в браузере обращается к нему через прокси Vite.
#
#    bash scripts/start-backend.sh install   # один раз: .venv сервиса
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

install_deps() {
  for service in vision-api; do
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
    if [ ! -x "services/vision-api/.venv/bin/python" ]; then
      echo "Сначала установите зависимости: bash scripts/start-backend.sh install" >&2
      exit 1
    fi
    cat <<INFO

============================================================
  IkGuide: локальный бэкенд
============================================================
  Распознавание 2D-чертежей: http://127.0.0.1:$VISION_PORT/health

  Остановить: Ctrl+C
INFO

    trap 'kill 0' EXIT INT TERM
    ( cd services/vision-api && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$VISION_PORT" ) &
    wait
    ;;
  *)
    echo "Используйте: install | run" >&2
    exit 2
    ;;
esac
