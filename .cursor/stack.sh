#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# On-demand product stack. start.sh is infra-only so cargo-test agents do not
# boot FusionAuth. Cargo, Bun, and BuildKit incrementally reconcile the checked
# out branch against the durable main-build caches before services start.

# shellcheck source=cloud-lib.sh
source "${SCRIPT_DIR}/cloud-lib.sh"

if ! in_pinned_nix_shell; then
  ensure_nix_daemon
  ensure_dockerd
  reenter_pinned_nix_shell "${SCRIPT_DIR}/stack.sh" "$@"
fi

/usr/bin/bash "${SCRIPT_DIR}/start.sh"

cd "${WORKSPACE_ROOT}"
snapshot_image_id="$(
  docker image inspect --format '{{.Id}}' "${STACK_SNAPSHOT_IMAGE}" 2>/dev/null \
    || printf 'missing'
)"
container_count="$(docker ps -aq | wc -l | tr -d ' ')"
volume_count="$(docker volume ls -q | wc -l | tr -d ' ')"

# region agent log
agent_debug_log "A,B" ".cursor/stack.sh:before_restore" \
  "inspected fresh-boot Docker and snapshot state" \
  "home=${HOME}" \
  "root=${MACRO_STACK_SNAPSHOT_DIR}" \
  "image=${STACK_SNAPSHOT_IMAGE}" \
  "image_id=${snapshot_image_id}" \
  "containers=${container_count}" \
  "volumes=${volume_count}"
# endregion

restore_stack_snapshot_image
snapshot_status="$(
  cargo run --quiet --manifest-path Cargo.toml -p xtask_local --features local-stack -- \
    stack snapshot --json
)"

# region agent log
agent_debug_log "B,C" ".cursor/stack.sh:after_restore" \
  "checked snapshot plan after image restore" \
  "root=${MACRO_STACK_SNAPSHOT_DIR}" \
  "status=${snapshot_status}"
# endregion

if just stack up --no-doppler --build-aux-services; then
  # region agent log
  agent_debug_log "D" ".cursor/stack.sh:stack_up_exit" \
    "full stack command exited" \
    "status=0"
  # endregion
else
  status=$?
  # region agent log
  agent_debug_log "D" ".cursor/stack.sh:stack_up_exit" \
    "full stack command exited" \
    "status=${status}"
  # endregion
  exit "${status}"
fi

echo "cursor-cloud stack: app ready"
