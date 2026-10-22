#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install Python 3.10 or newer, then run this script again."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required. Install Node.js 20 or newer, then run this script again."
  exit 1
fi

if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt

if [ ! -d frontend/node_modules ]; then
  (cd frontend && npm install)
fi

python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 > backend.log 2>&1 &
API_PID=$!
cd frontend
npm run dev -- --host 127.0.0.1 &
FRONT_PID=$!
cleanup() {
  kill "$FRONT_PID" >/dev/null 2>&1 || true
  kill "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
sleep 3
if command -v open >/dev/null 2>&1; then open http://127.0.0.1:5173 || true; fi
wait "$FRONT_PID"
