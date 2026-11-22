#!/usr/bin/env bash
# Apply the differential probe to one tree, check that every reader
# expression the probe copies still exists there, and optionally build the
# bundle. Usage: apply-probes.sh main|branch <tree> [build|typecheck|revert]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
which="$1"
tree="$(cd "$2" && pwd)"
action="${3:-apply}"
web="$tree/apps/web"
src="$web/src"
repo_root="${REPO_ROOT:?set REPO_ROOT to the macro checkout}"

revert() {
  git -C "$tree" checkout -q -- apps/web/src/routes/Root.tsx \
    apps/web/src/lib/core/context/quickAccess/QuickAccessSource.tsx \
    apps/web/src/lib/core/component/LexicalMarkdown/citationsUtils.ts \
    apps/web/src/lib/core/context/channels.ts
  (cd "$src" && rm -f __proof__/probe.tsx __proof__/mutant.ts && { rmdir __proof__ 2>/dev/null || true; })
}

if [ "$action" = revert ]; then
  revert
  git -C "$tree" status --porcelain
  exit 0
fi

# 1. Guards: every copied literal must still be in this tree.
missing=0
while IFS=$'\t' read -r t file literal; do
  [ "$t" = "$which" ] || continue
  if ! grep -qF -- "$literal" "$src/$file"; then
    echo "guard missing in $file: $literal" >&2
    missing=1
  fi
done < "$here/patches/guards.tsv"
[ "$missing" = 0 ] || exit 1

# 2. Apply on a clean tree only.
if [ -n "$(git -C "$tree" status --porcelain -- apps/web/src)" ]; then
  if [ -f "$src/__proof__/probe.tsx" ]; then revert; else
    echo "tree $tree has local changes under apps/web/src" >&2; exit 1
  fi
fi
mkdir -p "$src/__proof__"
cp "$here/patches/probe-$which.tsx" "$src/__proof__/probe.tsx"
if [ "$which" = branch ]; then
  cp "$here/patches/mutant.ts" "$src/__proof__/mutant.ts"
  sed -i 's#directory={createAppChannelDirectory()}#directory={proofMutant(createAppChannelDirectory())}#' \
    "$src/routes/Root.tsx"
  sed -i "1i import { proofMutant } from '@app/__proof__/mutant';" "$src/routes/Root.tsx"
  grep -qF 'proofMutant(createAppChannelDirectory())' "$src/routes/Root.tsx"
fi
sed -i 's#^\( *\)<Title>{tabTitle()}</Title>#&\n\1<ProofProbe />#' "$src/routes/Root.tsx"
sed -i "1i import { ProofProbe } from '@app/__proof__/probe';" "$src/routes/Root.tsx"
grep -qF '<ProofProbe />' "$src/routes/Root.tsx"
sed -i 's#^function apiChannelToQuickAccessChannel(#export function apiChannelToQuickAccessChannel(#' \
  "$src/lib/core/context/quickAccess/QuickAccessSource.tsx"
grep -qF 'export function apiChannelToQuickAccessChannel(' "$src/lib/core/context/quickAccess/QuickAccessSource.tsx"
sed -i 's#^const createChannelMentionXML = #export const createChannelMentionXML = #' \
  "$src/lib/core/component/LexicalMarkdown/citationsUtils.ts"
grep -qF 'export const createChannelMentionXML = ' "$src/lib/core/component/LexicalMarkdown/citationsUtils.ts"
echo "applied $which probe to $tree at $(git -C "$tree" rev-parse --short=11 HEAD)"

case "$action" in
  typecheck)
    cd "$web"
    timeout 1200 nix develop "$repo_root" --command bash -c \
      'bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tsconfig.json 2>&1' \
      | grep -E '__proof__|error TS' | grep -E '__proof__|Root.tsx|QuickAccessSource|citationsUtils|context/channels' || true
    ;;
  build)
    out="$HOME/.cache/gqlchan-bundles/proof-$which"
    cd "$web"
    rm -rf dist
    mkdir -p "$HOME/.cache/gqlchan-build-tmp"
    TMPDIR=$HOME/.cache/gqlchan-build-tmp MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL \
      VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true VITE_AI_EDITING_WORKER_URL=/ai-editing \
      VITE_LOCAL_STACK=true VITE_ENABLE_BROWSER_OTEL=true VITE_OTEL_EXPORTER_URL=/i/otlp/v1/traces \
      timeout 1500 nix develop "$repo_root" --command bun run --bun build
    test -f dist/index.html
    mkdir -p "$out"
    rsync -a --delete dist/ "$out/"
    git -C "$tree" rev-parse HEAD > "$out/.proof-commit"
    echo "built $out ($(ls "$out" | wc -l) files)"
    ;;
esac
