#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand product stack. Boot (start.sh) starts nothing; infra.sh brings up
# dockerd and the databases first. A healthy running stack is left alone —
# `stack up` is full-delete/full-create, so a blind re-run would wipe volumes
# (logins, documents). Pass --fresh to wipe and recreate deliberately.
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
  echo "cursor-cloud stack: already running at http://localhost:8090/app/"
  echo "cursor-cloud stack: backend edits -> bash .cursor/rebuild.sh"
  echo "cursor-cloud stack: frontend dev  -> bash .cursor/frontend.sh"
  echo "cursor-cloud stack: wipe + restart -> bash .cursor/stack.sh --fresh"
  exit 0
fi

build_local_stack_binaries
stack_doppler_args
run_with_bridge_forwarding \
  just stack up "${doppler_args[@]}" --build-aux-services --binaries-dir "${LOCAL_STACK_BINS}/bin"
ensure_docker_bridge_forwarding

echo "cursor-cloud stack: app ready"
