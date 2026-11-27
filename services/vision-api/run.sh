#!/usr/bin/env bash
# Local runner for the IkGuide vision service (CPU only, no CUDA, no model downloads).
#
#   bash services/vision-api/run.sh install   # create .venv and install Python dependencies
#   bash services/vision-api/run.sh dev       # install if needed, then serve on 0.0.0.0:8000
#   bash services/vision-api/run.sh test      # pytest inside the same virtualenv
#
# Requirements: python3 >= 3.10 on PATH. Windows users can call the same commands manually:
#   py -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt
#   .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SERVICE_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${VISION_PORT:-8000}"
HOST="${VISION_HOST:-0.0.0.0}"

cd "$SERVICE_DIR"

ensure_venv() {
  if [ ! -x "$VENV/bin/python" ]; then
    echo "▸ Создаём виртуальное окружение Python…"
    "$PYTHON_BIN" -m venv "$VENV"
  fi
}

deps_ready() {
  "$VENV/bin/python" - <<'PY' >/dev/null 2>&1
import cv2, fastapi, numpy, pymupdf, uvicorn
PY
}

install_deps() {
  ensure_venv
  if [ "${FORCE_INSTALL:-0}" = "1" ] || ! deps_ready; then
    echo "▸ Устанавливаем зависимости сервиса распознавания…"
    "$VENV/bin/python" -m pip install --upgrade pip >/dev/null
    "$VENV/bin/python" -m pip install -r requirements.txt
  else
    echo "▸ Зависимости уже установлены."
  fi
  # OCR is optional: without it the service still reads vector PDFs and reports `ocr: none`.
  if ! "$VENV/bin/python" -c "import rapidocr_onnxruntime" >/dev/null 2>&1; then
    echo "▸ Ставим OCR-движок RapidOCR (можно пропустить: SKIP_OCR=1)."
    if [ "${SKIP_OCR:-0}" != "1" ]; then
      "$VENV/bin/python" -m pip install -r requirements-ocr.txt || \
        echo "⚠ OCR не установился — сервис будет работать без распознавания фото."
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
    echo "▸ Сервис распознавания: http://127.0.0.1:${PORT} (docs: /docs)"
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
