#!/usr/bin/env bash
# After the final checks: the harness at main, and the harness and document
# storage service at the drafter branch's head, for the eval and the stack.
set -u
C=~/.cache/routines-draft-subroutines
until grep -q "^== done" $C/final-checks.log 2>/dev/null; do sleep 10; done
ENV=$S/env.sh
T=$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/target
export TMPDIR=$HOME/.cache/pw
build() { # dir, out-dir, bins...
  local dir=$1 out=$2; shift 2
  local args=()
  for b in "$@"; do args+=(--bin "$b"); done
  \cd "$dir" || return 1
  for attempt in 1 2; do
    nix develop "$dir" --command bash -c "source $ENV; unset DATABASE_URL; bun install --frozen-lockfile >/dev/null 2>&1; echo root:\$?; (\cd packages/sdk && bun install --frozen-lockfile >/dev/null 2>&1; echo sdk:\$?); SQLX_OFFLINE=true cargo build -j 10 ${args[*]} 2>&1 | tail -3" 2>&1 | grep -v "Git tree" | tee /dev/stderr | grep -q "failed to move dependency graph" || break
    echo "retry after a shared-target race"
  done
  mkdir -p "$out"
  for b in "$@"; do cp -f "$T/debug/$b" "$out/"; done
}
M=$C/main-wt; B=$HOME/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions
m=$(git -C $M rev-parse --short=11 HEAD); b=$(git -C $B rev-parse --short=11 HEAD)
echo "== main $m $(date -u +%T)"
build $M $C/bin/main-$m agent_harness_service
echo "== pr2 $b $(date -u +%T)"
build $B $C/bin/pr2-$b agent_harness_service document_storage_service
echo "== done $(date -u +%T)"
ls -la $C/bin/main-$m $C/bin/pr2-$b
