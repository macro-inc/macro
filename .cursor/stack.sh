#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand product stack: backend containers behind the proxy (8090) plus
# the hot-reloading frontend dev server (3000). There is no static frontend
# on Cloud — the dev server IS the frontend, so edits under apps/web apply
# on save. A healthy running backend is left alone — `stack up` is
# full-delete/full-create, so a blind re-run would wipe volumes (logins,
# documents). Pass --fresh to wipe and recreate deliberately.
# After backend edits, run rebuild.sh: it remounts new Nix binaries in place.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  reenter_pinned_nix_shell "${SCRIPT_DIR}/stack.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/infra.sh"

\cd "${WORKSPACE_ROOT}"

if [ "${1:-}" != "--fresh" ] \
  && curl -fsS --max-time 3 http://localhost:8090/auth/health >/dev/null 2>&1; then
  echo "cursor-cloud stack: backend already running"
else
  build_local_stack_binaries
  stack_doppler_args
  run_with_bridge_forwarding \
    just stack up "${doppler_args[@]}" --no-frontend --build-aux-services \
    --binaries-dir "${LOCAL_STACK_BINS}/bin"
  ensure_docker_bridge_forwarding
fi

/usr/bin/bash "${SCRIPT_DIR}/frontend.sh"

echo "cursor-cloud stack: app ready at http://localhost:3000/app"
echo "cursor-cloud stack: backend edits -> bash .cursor/rebuild.sh"
echo "cursor-cloud stack: frontend edits apply on save (no command)"
echo "cursor-cloud stack: wipe + restart -> bash .cursor/stack.sh --fresh"
