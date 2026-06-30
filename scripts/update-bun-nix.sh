#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/update-bun-nix.sh [--check]

Regenerate js/bun.nix from js/bun.lock using the bun2nix version pinned in
flake.lock. With --check, fail if the checked-in js/bun.nix is stale.
EOF
}

check=false
case "${1-}" in
  "") ;;
  --check) check=true ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root/js"

if [ "$check" = true ]; then
  generated=$(mktemp)
  trap 'rm -f "$generated"' EXIT
  RUST_LOG="${RUST_LOG:-error}" nix run "$repo_root#bun2nix" -- -l bun.lock -o "$generated"
  if ! cmp -s bun.nix "$generated"; then
    echo "js/bun.nix is stale. Run: just update-bun-nix" >&2
    diff -u bun.nix "$generated" || true
    exit 1
  fi
  echo "js/bun.nix is up to date"
else
  RUST_LOG="${RUST_LOG:-error}" nix run "$repo_root#bun2nix" -- -l bun.lock -o bun.nix
fi
