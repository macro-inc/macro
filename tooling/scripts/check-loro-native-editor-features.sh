#!/usr/bin/env bash
# Fails if any workspace package other than the native editor session enables
# loro-internal's `native-editor` feature in its normal or build dependency graph.
# The feature switches on the editor's local runtime changes in
# vendor/loro-editor (see its README); servers must run upstream 1.17.1.
#
# Each package resolves alone, as its deploy build does (`--package X --bin Y`):
# Cargo unifies features across every package one command selects, so a single
# workspace-wide resolution would mix the editor into every server.
#
# Checked: every workspace member whose normal/build graph reaches the editor's
# loro-internal, for all targets, plus sync_service for wasm32. Allowed: the
# document session and the crates built on it, which are the native editor.
# sync_sim is test-only: it links document_session beside sync_server_core, so
# in its builds (and any `--workspace` test build) server code runs with the
# feature on. No deployed binary resolves that way.
set -euo pipefail

cd "$(dirname "$0")/../.."

internal=loro-internal@1.17.1
feature='loro-internal feature "native-editor"'
allowed=(document_session document_session_ffi document_session_wasm sync_sim)
status=0

# Whether the package resolution enables the feature. A package whose graph does
# not reach the editor's loro-internal cannot enable it; any other cargo failure
# aborts, so the check never passes on an error.
enabled() {
  local tree
  if ! tree=$(cargo tree --locked -e features,normal,build -i "$internal" --prefix none "$@" 2>&1); then
    if grep -qF "\`$internal\` did not match any packages" <<<"$tree"; then
      return 1
    fi
    echo "$tree" >&2
    exit 1
  fi
  grep -qF "$feature" <<<"$tree"
}

# Positive control: the grep must find the feature where it is meant to be on.
if ! enabled -p document_session --target all; then
  echo "document_session no longer enables $feature; this check would pass vacuously" >&2
  exit 1
fi

# Capture first: a failure inside a process substitution would not stop the script.
dependents=$(cargo tree --locked --workspace -e normal,build -i "$internal" --prefix none \
  --format '{p}' --target all)
mapfile -t packages < <(awk '$3 ~ /^\(\// { print $1 }' <<<"$dependents" | sort -u)
if [ "${#packages[@]}" -lt 10 ]; then
  echo "only ${#packages[@]} packages reach $internal; the dependent scan is broken" >&2
  exit 1
fi

checked=0
for package in "${packages[@]}"; do
  [ "$package" = loro-internal ] && continue
  [[ " ${allowed[*]} " == *" $package "* ]] && continue
  checked=$((checked + 1))
  if enabled -p "$package" --target all; then
    echo "$package enables $feature" >&2
    status=1
  fi
done

# The sync worker deploys as wasm32; check that target explicitly.
checked=$((checked + 1))
if enabled -p sync_service --target wasm32-unknown-unknown; then
  echo "sync_service (wasm32) enables $feature" >&2
  status=1
fi

if [ "$status" -ne 0 ]; then
  echo "native-editor must stay confined to the native editor session" >&2
  exit 1
fi
echo "native-editor is off in all $checked checked packages; on only in ${allowed[*]}"
