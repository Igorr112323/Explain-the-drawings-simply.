#!/usr/bin/env bash
# ============================================================================
#  ИК-Гайд — цеховой сервер (Linux / macOS, для разработки и демо).
#
#  Запускает оба Python-сервиса на 0.0.0.0, чтобы планшет в локальной сети мог
#  до них достучаться, и печатает адреса для «Настройки и подключение».
#
#    bash scripts/start-workshop-servers.sh install   # один раз: два .venv
#    npm run workshop:servers                         # обычный запуск
#
#  Windows-цех использует scripts/start-workshop-servers.bat — он же лежит в
#  портативном архиве бэкенда в GitHub Release.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-run}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VISION_PORT="${VISION_PORT:-8000}"
CAD_PORT="${CAD_PORT:-8001}"

lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null && return 0
  fi
  if command -v ip >/dev/null 2>&1; then
    ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' && return 0
  fi
  ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' || true
}

install_deps() {
  for service in vision-api cad-api; do
    echo "▸ $service: виртуальное окружение и зависимости"
    if [ ! -x "services/$service/.venv/bin/python" ]; then
      "$PYTHON_BIN" -m venv "services/$service/.venv"
    fi
    "services/$service/.venv/bin/python" -m pip install --upgrade pip >/dev/null
    "services/$service/.venv/bin/python" -m pip install -r "services/$service/requirements.txt"
  done
  echo "✓ Готово. Теперь: npm run workshop:servers"
}

case "$MODE" in
  install)
    install_deps
    ;;
  run)
    if [ ! -x "services/vision-api/.venv/bin/python" ] || [ ! -x "services/cad-api/.venv/bin/python" ]; then
      echo "Сначала установите зависимости: bash scripts/start-workshop-servers.sh install" >&2
      exit 1
    fi
    IP="$(lan_ip)"
    IP="${IP:-127.0.0.1}"
    cat <<INFO

============================================================
  ИК-Гайд: цеховой сервер
============================================================
  Распознавание чертежей:  http://$IP:$VISION_PORT/health
  3D-модели и схемы:       http://$IP:$CAD_PORT/v1/cad/health

  Впишите в планшете в «Настройки и подключение»:
    распознавание: http://$IP:$VISION_PORT
    3D-модели:     http://$IP:$CAD_PORT

  Остановить серверы: Ctrl+C
INFO

    trap 'kill 0' EXIT INT TERM
    ( cd services/vision-api && exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$VISION_PORT" ) &
    ( cd services/cad-api && exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "$CAD_PORT" ) &
    wait
    ;;
  *)
    echo "Используйте: install | run" >&2
    exit 2
    ;;
esac
