#!/usr/bin/env bash
# Builds the harness and document storage service at the drafter branch's
# head (the backend of the whole stack: the web branch above it changes no
# Rust), for the drafting eval and the proof stack.
set -u
C=~/.cache/routines-draft-subroutines
ENV=$S/env.sh
W=$HOME/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions
T=$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/target
export TMPDIR=$HOME/.cache/pw
sha=$(git -C "$W" rev-parse --short=11 HEAD)
out=$C/bin/pr2-$sha
echo "== build $sha $(date -u +%T)"
\cd "$W" || exit 1
for attempt in 1 2; do
  nix develop "$W" --command bash -c "source $ENV; unset DATABASE_URL; SQLX_OFFLINE=true cargo build -j 4 --bin agent_harness_service --bin document_storage_service 2>&1 | tail -3" 2>&1 | grep -v "Git tree" | tee /dev/stderr | grep -q "failed to move dependency graph" || break
  echo "retry after a shared-target race"
done
mkdir -p "$out"
for b in agent_harness_service document_storage_service; do cp -f "$T/debug/$b" "$out/"; done
echo "== done $(date -u +%T)"
ls -la "$out"
