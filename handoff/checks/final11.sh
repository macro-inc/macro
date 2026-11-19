#!/usr/bin/env bash
# Final checks on the three final heads, then the drafter head's services for the stack and the eval, and main's (80227ffc54b) for the eval baseline.
set -u
C=~/.cache/routines-draft-subroutines
A=$HOME/.herdr/worktrees/macro/synoet-routines-sub-routine-definitions
B=$HOME/.herdr/worktrees/macro/synoet-routines-draft-sub-routine-definitions
E=$HOME/.herdr/worktrees/macro/synoet-routines-sub-routine-editor
M=$C/main-wt
T=$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/target
ENV=$S/env.sh
for side in A B; do
  W=${!side}
  sha=$(git -C $W rev-parse --short=11 HEAD)
  L=$C/final11/$side-$sha; mkdir -p $L
  echo "== $side $sha $(date -u +%T)"
  \cd $W && nix develop $W --command bash -c "source $ENV
    bun install --frozen-lockfile > $L/bun-install.log 2>&1; echo bun-install=\$?
    cargo test -j 16 -p scheduled_action -p routine_program -p routines -p agent_correlation -p system_skills -p agent_session > $L/tests.log 2>&1; echo tests=\$?
    grep -q 'test result: FAILED' $L/tests.log && { cargo test -j 16 -p scheduled_action -p routine_program -p routines -p agent_correlation -p system_skills -p agent_session > $L/tests-rerun.log 2>&1; echo tests-rerun=\$?; }
    PATH=\$HOME/.cache/deno-2.9.6:\$PATH cargo test -j 16 -p agent_harness_service --lib -- --ignored --test-threads=1 routine_code:: > $L/deno.log 2>&1; echo deno=\$?
    (\cd packages/sdk && bun test > $L/sdk-test.log 2>&1; echo sdk=\$?; bun run check > $L/sdk-tsc.log 2>&1; echo sdk-tsc=\$?; bun run lint > $L/sdk-lint.log 2>&1; echo sdk-lint=\$?; bun run coverage > $L/sdk-coverage.log 2>&1; echo sdk-coverage=\$?)
    (\cd packages/sdk-mcp && bun run generate > $L/mcp-gen.log 2>&1 && bunx vitest run > $L/sdk-mcp.log 2>&1; echo sdk-mcp=\$?)
    if [ -d crates/scheduled_action/bench ]; then (\cd crates/scheduled_action/bench && bun test > $L/bench-test.log 2>&1; echo bench-test=\$?; bunx --no-install tsc --noEmit --target esnext --module preserve --moduleResolution bundler --types bun --skipLibCheck --strict *.ts > $L/bench-tsc.log 2>&1; echo bench-tsc=\$?); fi
    unset DATABASE_URL
    RUSTFLAGS='-Dwarnings -Dclippy::disallowed_methods' RUSTDOCFLAGS=-Dwarnings SQLX_OFFLINE=true cargo clippy -j 16 -p routine_program -p scheduled_action -p routines -p agent_harness_service -p agent_correlation -p system_skills -p agent_session --all-features > $L/clippy.log 2>&1; echo clippy=\$?
    cargo fmt --all -- --check > $L/fmt.log 2>&1; echo fmt=\$?" 2>&1 | grep -v "Git tree\|rmeta"
  grep -hE "^test result" $L/tests.log $L/deno.log | sort | uniq -c
  [ -f $L/tests-rerun.log ] && { echo rerun:; grep -hE "^test result|panicked" $L/tests.log | head -5; grep -hE "^test result" $L/tests-rerun.log | sort | uniq -c; }
  grep -hE "^ *[0-9]+ (pass|fail)" $L/sdk-test.log; grep -h "Tests " $L/sdk-mcp.log; [ -f $L/bench-test.log ] && grep -hE "^ *[0-9]+ (pass|fail)" $L/bench-test.log
done
echo "== gen-api $(date -u +%T)"
bash $C/gen-api-check.sh synoet-routines-sub-routine-definitions synoet-routines-draft-sub-routine-definitions
echo "== deps and just check $(date -u +%T)"
\cd $A && nix develop $A --command bash -c "source $ENV; cargo x deps --check > $C/final11/deps-A.log 2>&1; echo deps=\$?" 2>&1 | grep -v "Git tree\|rmeta"
for side in A B E; do
  W=${!side}
  base=$(case $side in A) echo origin/main;; B) echo synoet/routines-sub-routine-definitions;; E) echo synoet/routines-draft-sub-routine-definitions;; esac)
  \cd $W && nix develop $W --command bash -c "export TMPDIR=\$HOME/.cache/pw; CHECK_BASE=$base just check > $C/final11/just-check-$side.log 2>&1; echo just-check-$side=\$?; CHECK_BASE=$base just pr-privacy > $C/final11/pr-privacy-$side.log 2>&1; echo pr-privacy-$side=\$?" 2>&1 | grep -v "Git tree\|rmeta"
done
echo "== web $(date -u +%T)"
\cd $E && nix develop $E --command bash -c "export TMPDIR=\$HOME/.cache/pw; bun install --frozen-lockfile > /dev/null 2>&1; echo bun-install=\$?" 2>&1 | grep -v "Git tree\|rmeta"
nix develop $E --command bash $C/pr3/checks6.sh 2>&1 | grep -v "Git tree\|rmeta"
echo "== bins $(date -u +%T)"
build() { # checkout, out-dir
  local dir=$1 out=$2
  \cd "$dir" || return 1
  for attempt in 1 2; do
    nix develop "$dir" --command bash -c "source $ENV; unset DATABASE_URL; SQLX_OFFLINE=true cargo build -j 16 --bin agent_harness_service --bin document_storage_service > $out.build.log 2>&1; echo build=\$?" 2>&1 | grep -v "Git tree\|rmeta"
    grep -q "failed to move dependency graph" $out.build.log || break
    echo "retry after a shared-target race"
  done
  mkdir -p "$out"
  cp -f $T/debug/agent_harness_service $T/debug/document_storage_service "$out/"
}
b=$(git -C $B rev-parse --short=11 HEAD)
build $B $C/bin/pr2-$b
rm -f $C/bin/stack-top/document_storage_service $C/bin/stack-top/agent_harness_service
cp $C/bin/pr2-$b/document_storage_service $C/bin/pr2-$b/agent_harness_service $C/bin/stack-top/
ls -la $C/bin/stack-top/document_storage_service $C/bin/stack-top/agent_harness_service; sha256sum $C/bin/pr2-$b/* $C/bin/stack-top/document_storage_service $C/bin/stack-top/agent_harness_service
echo "== main baseline $(date -u +%T)"
git -C $M switch -q --detach 80227ffc54b && git -C $M log --oneline -1 | cat
build $M $C/bin/main-80227ffc54b
sha256sum $C/bin/main-80227ffc54b/*
echo "== done $(date -u +%T)"
