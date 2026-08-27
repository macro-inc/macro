#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# THE frontend on Cloud: a hot-reloading Vite dev server against the running
# backend. stack.sh starts it; edits under apps/web apply on save. There is
# no static bundle — http://localhost:3000/app is the only app URL.
#
#   bash .cursor/frontend.sh        # start (no-op if already serving)
#   bash .cursor/frontend.sh stop   # stop the dev server

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/frontend.sh" "$@"
fi

FRONTEND_PORT=3000
PROXY_ORIGIN='http://localhost:8090'
DEV_URL="http://localhost:${FRONTEND_PORT}/app"
PID_FILE="${LOG_DIR}/frontend-dev.pid"
DEV_LOG="${LOG_DIR}/frontend-dev.log"

if [ "${1:-}" = "stop" ]; then
  if [ -f "${PID_FILE}" ]; then
    pgid="$(cat "${PID_FILE}")"
    kill -- "-${pgid}" 2>/dev/null || true
    rm -f "${PID_FILE}"
    echo "cursor-cloud frontend: stopped"
  else
    echo "cursor-cloud frontend: not running (no pid file)"
  fi
  exit 0
fi

if curl -fsS --max-time 2 "${DEV_URL}" >/dev/null 2>&1; then
  echo "cursor-cloud frontend: already serving at ${DEV_URL}"
  exit 0
fi

if ! curl -fsS --max-time 3 "${PROXY_ORIGIN}/auth/health" >/dev/null 2>&1; then
  echo "cursor-cloud frontend: stack is not running — run: bash .cursor/stack.sh" >&2
  exit 1
fi

: >"${DEV_LOG}"
\cd "${WORKSPACE_ROOT}/apps/web"
setsid env \
  PORT="${FRONTEND_PORT}" \
  VITE_LOCAL_SERVERS=ALL \
  VITE_LOCAL_BACKEND_ORIGIN="${PROXY_ORIGIN}" \
  VITE_AI_EDITING_WORKER_URL="${PROXY_ORIGIN}/ai-editing" \
  bun run --bun dev >>"${DEV_LOG}" 2>&1 </dev/null &
echo "$!" >"${PID_FILE}"

# Cold starts build wasm packages before Vite binds; be patient once.
n=0
while [ "${n}" -lt 300 ]; do
  if ! kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
    echo "cursor-cloud frontend: dev server exited during startup" >&2
    tail -40 "${DEV_LOG}" >&2
    rm -f "${PID_FILE}"
    exit 1
  fi
  if curl -fsS --max-time 2 "${DEV_URL}" >/dev/null 2>&1; then
    echo "cursor-cloud frontend: hot-reloading dev server at ${DEV_URL}"
    echo "cursor-cloud frontend: logs at ${DEV_LOG}"
    exit 0
  fi
  n=$((n + 1))
  sleep 1
done
echo "cursor-cloud frontend: dev server did not become ready" >&2
tail -40 "${DEV_LOG}" >&2
exit 1
