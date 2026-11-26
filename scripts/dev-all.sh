#!/usr/bin/env bash
# Starts the Python recognition service and the studio dev server.
# Every service is optional: a missing venv only prints a hint, the studio still runs.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}

trap cleanup EXIT INT TERM

start() {
  local name="$1"
  shift
  echo "▶ $name"
  "$@" &
  PIDS+=("$!")
}

start "vision-api  :8000" bash services/vision-api/run.sh dev

echo "▶ studio      :5173"
npm run dev -w @ikguide/studio-web
