#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(\cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The local stack builds with the repository's Nix shell, which supplies the
# compiler and libraries the binaries link. This wrapper only enters that shell. Xtask owns the E2E lifecycle itself.
if [[ -z "${IN_NIX_SHELL:-}" ]]; then
  if [[ "${LOCAL_E2E_NIX_REEXEC:-}" == "1" ]]; then
    echo "local E2E failed to enter the repository Nix development shell" >&2
    exit 1
  fi
  if ! command -v nix >/dev/null 2>&1; then
    echo "local E2E requires the repository Nix development shell (nix was not found)" >&2
    exit 1
  fi
  export LOCAL_E2E_NIX_REEXEC=1
  exec nix develop "$ROOT_DIR" --command "$ROOT_DIR/tooling/scripts/run-local-e2e.sh" "$@"
fi

exec cargo run --quiet --manifest-path "$ROOT_DIR/Cargo.toml" \
  -p xtask_local --features local-stack -- local-e2e "$@"
