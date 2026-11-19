#!/usr/bin/env bash
# Build the drafter head's binaries, then run the final drafting eval against main.
set -u
C=~/.cache/routines-draft-subroutines
B=$HOME/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions
E=$HOME/.herdr/worktrees/macro/synoet-routines-sub-routine-editor
T=$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/target
ENV=$S/env.sh
bsha=$(git -C $B rev-parse --short=11 HEAD)
out=$C/bin/pr2-$bsha
echo "== bins $bsha $(date -u +%T)"
\cd $B && for attempt in 1 2; do
  nix develop $B --command bash -c "source $ENV; unset DATABASE_URL; SQLX_OFFLINE=true cargo build -j 10 --bin agent_harness_service --bin document_storage_service > $C/final/build-$bsha.log 2>&1; echo build=\$?" 2>&1 | grep -v "Git tree"
  grep -q "failed to move dependency graph" $C/final/build-$bsha.log || break
  echo "retry after a shared-target race"
done
mkdir -p $out && cp -f $T/debug/agent_harness_service $T/debug/document_storage_service $out/ && ls -la $out
# The stack serves the drafter head's scheduler while both drafters are compared.
rm -f $C/bin/stack-top/document_storage_service $C/bin/stack-top/agent_harness_service
cp $out/document_storage_service $out/agent_harness_service $C/bin/stack-top/
nix develop $E --command bash $C/eval5/restart-dss.sh 2>&1 | grep -v "Git tree"
echo "== eval $(date -u +%T)"
MAIN_BIN=$C/bin/main-be50abb4dc1 BRANCH_BIN=$out bash $C/eval5/run.sh
