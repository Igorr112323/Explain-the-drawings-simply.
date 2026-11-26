#!/usr/bin/env bash
# Local runner for the IkGuide 3D CAD service (CPU only, no CUDA, no OpenGL).
#
#   bash services/cad-api/run.sh install   # create .venv and install Python dependencies
#   bash services/cad-api/run.sh dev       # install if needed, then serve on 0.0.0.0:8000
#   bash services/cad-api/run.sh test      # pytest inside the same virtualenv
#
# Requirements: python3 >= 3.10 on PATH. Windows users can call the same commands manually:
#   py -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt
#   .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SERVICE_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${CAD_PORT:-8001}"
HOST="${CAD_HOST:-0.0.0.0}"

cd "$SERVICE_DIR"

ensure_venv() {
  if [ ! -x "$VENV/bin/python" ]; then
    echo "▸ Создаём виртуальное окружение Python…"
    "$PYTHON_BIN" -m venv "$VENV"
  fi
}

deps_ready() {
  "$VENV/bin/python" - <<'PY' >/dev/null 2>&1
import fastapi, numpy, scipy, trimesh, uvicorn
PY
}

install_deps() {
  ensure_venv
  if [ "${FORCE_INSTALL:-0}" = "1" ] || ! deps_ready; then
    echo "▸ Устанавливаем зависимости CAD-сервиса…"
    "$VENV/bin/python" -m pip install --upgrade pip >/dev/null
    "$VENV/bin/python" -m pip install -r requirements.txt
  else
    echo "▸ Зависимости уже установлены."
  fi
  # STEP is optional: without cascadio the service still reads STL/OBJ/GLB/GLTF.
  if ! "$VENV/bin/python" -c "import cascadio" >/dev/null 2>&1; then
    echo "▸ Ставим STEP-движок cascadio (можно пропустить: SKIP_STEP=1)."
    if [ "${SKIP_STEP:-0}" != "1" ]; then
      "$VENV/bin/python" -m pip install -r requirements-step.txt || \
        echo "⚠ STEP-движок не установился — STEP/STP будут недоступны, остальные форматы работают."
    fi
  fi
}

case "${1:-dev}" in
  install)
    install_deps
    echo "✓ Готово. Запуск: npm run dev:vision"
    ;;
  dev)
    install_deps
    echo "▸ CAD-сервис: http://127.0.0.1:${PORT} (docs: /docs)"
    exec "$VENV/bin/python" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
    ;;
  test)
    install_deps
    shift || true
    exec "$VENV/bin/python" -m pytest "$@"
    ;;
  *)
    echo "Неизвестная команда: $1" >&2
    echo "Используйте: install | dev | test" >&2
    exit 2
    ;;
esac
