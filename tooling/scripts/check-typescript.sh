#!/usr/bin/env bash
# Biome + tsc for TypeScript packages and services that Web App Pr Checks
# and SDK Check do not cover. Invoked by CI (`code_check_typescript`) and by
# `just check` for the matching changed projects.
#
# Usage:
#   tooling/scripts/check-typescript.sh [--biome] [--tsc] [--only dir,dir]
# Default: both biome and tsc across every project.

set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$root" ]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "$root"

do_biome=0
do_tsc=0
only=""

while [ $# -gt 0 ]; do
  case "$1" in
    --biome) do_biome=1 ;;
    --tsc) do_tsc=1 ;;
    --only)
      shift
      only="${1:-}"
      ;;
    --only=*)
      only="${1#--only=}"
      ;;
    *)
      echo "usage: $0 [--biome] [--tsc] [--only dir,dir]" >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$do_biome" -eq 0 ] && [ "$do_tsc" -eq 0 ]; then
  do_biome=1
  do_tsc=1
fi

# dir|tsc command (empty = biome only)
projects=(
  "packages/lexical-core|bun run type-check"
  "packages/loro-mirror|bun run typecheck"
  "packages/observability|bun run type-check"
  "packages/email-renderer|bun run type-check"
  "services/ai-editing-worker|bun run type-check"
  "services/lexical-service|bun run check"
  "services/cla-worker|bun run check"
  "services/analytics-proxy|bun run check"
  "services/websocket-service|bun run check"
  "services/coding-agent-worker|"
  "services/bots/stripe-payment-bot|bun run check"
  "services/bots/anthropic-status-bot|bun run check"
)

want_project() {
  local dir="$1"
  if [ -z "$only" ]; then
    return 0
  fi
  local IFS=,
  local item
  for item in $only; do
    if [ "$item" = "$dir" ]; then
      return 0
    fi
  done
  return 1
}

biome_cmd() {
  if command -v biome >/dev/null 2>&1; then
    biome ci --colors=off --error-on-warnings
  else
    bunx --bun @biomejs/biome ci --colors=off --error-on-warnings
  fi
}

fail=0
for spec in "${projects[@]}"; do
  dir="${spec%%|*}"
  tsc_cmd="${spec#*|}"
  if ! want_project "$dir"; then
    continue
  fi

  if [ "$do_biome" -eq 1 ]; then
    echo "── biome ($dir)"
    if (cd "$dir" && biome_cmd); then
      :
    else
      echo "   fix: (cd $dir && bunx @biomejs/biome check --write)"
      fail=1
    fi
  fi

  if [ "$do_tsc" -eq 1 ] && [ -n "$tsc_cmd" ]; then
    echo "── tsc ($dir)"
    if (cd "$dir" && $tsc_cmd); then
      :
    else
      echo "   fix: (cd $dir && $tsc_cmd)"
      fail=1
    fi
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "FAIL"
  exit 1
fi
echo "OK"
