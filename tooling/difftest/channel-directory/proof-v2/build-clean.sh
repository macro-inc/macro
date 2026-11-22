#!/usr/bin/env bash
# Build unprobed bundles for the browser proof (cold start, videos, events).
# Usage: build-clean.sh <name>=<tree> ...   ->  ~/.cache/gqlchan-bundles/clean-<name>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo_root="${REPO_ROOT:?set REPO_ROOT to the macro checkout}"
for spec in "$@"; do
  name="${spec%%=*}"; tree="$(cd "${spec#*=}" && pwd)"
  if [ -d "$tree/apps/web/src/__proof__" ]; then bash "$here/apply-probes.sh" x "$tree" revert >/dev/null; fi
  dirty="$(git -C "$tree" status --porcelain --untracked-files=no)"
  [ -z "$dirty" ] || { echo "$name: tree not clean: $dirty" >&2; exit 1; }
  out="$HOME/.cache/gqlchan-bundles/clean-$name"
  ( cd "$tree/apps/web" && rm -rf dist && mkdir -p "$HOME/.cache/gqlchan-build-tmp" &&
    TMPDIR=$HOME/.cache/gqlchan-build-tmp MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL \
      VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true VITE_AI_EDITING_WORKER_URL=/ai-editing \
      VITE_LOCAL_STACK=true VITE_ENABLE_BROWSER_OTEL=true VITE_OTEL_EXPORTER_URL=/i/otlp/v1/traces \
      timeout 1800 nix develop "$repo_root" --command bun run --bun build > "$HOME/.cache/gqlchan-build-tmp/clean-$name.log" 2>&1 &&
    test -f dist/index.html )
  mkdir -p "$out"; rsync -a --delete "$tree/apps/web/dist/" "$out/"
  git -C "$tree" rev-parse HEAD > "$out/.proof-commit"
  echo "built clean-$name at $(cut -c1-11 "$out/.proof-commit") ($(ls "$out" | wc -l) files)"
done
