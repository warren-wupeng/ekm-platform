#!/bin/sh
# start_worker.sh — launches a minimal HTTP health-check server alongside
# the Celery worker so that Fly.io's auto-start mechanism can wake this
# machine when the API dispatches a task.
#
# The health server listens on HEALTH_PORT (default 8080) and responds to
# any GET / with 200 OK.  It is only reachable on Fly's private 6PN
# network via ekm-worker.flycast — it is NOT exposed to the public internet.
#
# Cold-start behaviour (auto_stop_machines = "suspend"):
#   1. Worker machine suspends after IDLE_TIMEOUT with no tasks.
#   2. API backend calls http://ekm-worker.flycast (fire-and-forget).
#   3. Fly proxy receives the request → resumes the suspended machine (~seconds).
#   4. Health server answers → machine is up → Celery picks up queued tasks.

HEALTH_PORT=${HEALTH_PORT:-8080}

# Start the health server in the background and remember its PID so we
# can clean it up when Celery exits.
python -m http.server "$HEALTH_PORT" &
HEALTH_PID=$!

cleanup() {
    kill "$HEALTH_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Run Celery in the foreground.  When it exits (graceful shutdown or crash),
# the EXIT trap above kills the health server so no orphaned process remains.
celery -A app.worker.celery_app worker --loglevel=info --concurrency=2
