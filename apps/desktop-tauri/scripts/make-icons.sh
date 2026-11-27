#!/usr/bin/env bash
# Regenerates every icon from scripts/build-icons.py (Pillow lives in the vision service venv).
set -euo pipefail
cd "$(dirname "$0")/../../.."
PYTHON="${PYTHON:-services/vision-api/.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "Нужен Python с Pillow: запустите npm run install:vision или задайте PYTHON=python3" >&2
  exit 1
fi
"$PYTHON" scripts/build-icons.py
