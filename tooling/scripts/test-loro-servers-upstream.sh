#!/usr/bin/env bash
# Builds and tests the server-side Loro consumers as they deploy: with
# loro-internal's native-editor feature off, so they run upstream 1.17.1.
# Workspace-wide test builds unify the feature on for them (through
# document_session), so this is the job that keeps the shipped configuration
# under test. It first proves this exact selection resolves the feature off.
set -euo pipefail

cd "$(dirname "$0")/../.."

feature='loro-internal feature "native-editor"'
servers=(-p sync_server_core -p sync_protocol -p sync_server_sim -p macro_document_model)

assert_off() {
  local tree
  if ! tree=$(cargo tree --locked -e features,normal,build,dev -i loro-internal@1.17.1 \
    --prefix none "$@" 2>&1); then
    if grep -qF 'did not match any packages' <<<"$tree"; then
      return 0
    fi
    echo "$tree" >&2
    exit 1
  fi
  if grep -qF "$feature" <<<"$tree"; then
    echo "this selection enables $feature: $*" >&2
    exit 1
  fi
}

assert_off "${servers[@]}" --all-features
cargo test --locked "${servers[@]}" --all-features

# The sync worker's deployed wasm build (worker-build, default features).
assert_off -p sync_service --target wasm32-unknown-unknown
cargo build --locked -p sync_service --lib --target wasm32-unknown-unknown
echo "server Loro consumers build and pass with native-editor off"
