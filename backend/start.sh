#!/usr/bin/env bash
# Start both ASGI applications:
#   • app.main:app        on port 8000 — public API, exposed via Fly [[services]]
#   • app.internal_app:internal_app on port 8001 — internal-only, NOT in [[services]]
#
# Port 8001 is reachable from other Fly machines on the private network at
# http://ekm-backend.internal:8001, but is never forwarded to the public internet.

set -e

cleanup() {
    kill "$INTERNAL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

uvicorn app.internal_app:internal_app \
  --host 0.0.0.0 \
  --port 8001 \
  --workers 1 &

INTERNAL_PID=$!

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1
