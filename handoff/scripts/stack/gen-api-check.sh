#!/usr/bin/env bash
# Checks the generated API types against each branch's OpenAPI output, as
# CI's "Generate API Types" step does. Binaries go to the shared target; the
# tool-schema generator looks for its own in the worktree's target, so it is
# linked there. gen-api rewrites the generated files in place: a clean run
# leaves `git status` clean.
ENV=$S/env.sh
for w in "$@"; do
  W=$HOME/.herdr/worktrees/macro/$w
  echo "== $w $(git -C $W rev-parse --short HEAD) $(date -u +%T)"
  \cd $W/apps/web && nix develop $W --command bash -c "source $ENV; unset DATABASE_URL; export SQLX_OFFLINE=true TMPDIR=\$HOME/.cache/pw
    bins=\$(bun scripts/generate-api-schema.ts --print-cargo-bins 2>/dev/null | tail -1)
    (\\cd $W && cargo build -j 4 \$bins --bin gen_tool_schemas --bin agent_fold_types --bin export_review_types 2>&1 | tail -2)
    mkdir -p $W/target/debug
    for b in gen_tool_schemas agent_fold_types export_review_types; do ln -sf \$CARGO_TARGET_DIR/debug/\$b $W/target/debug/\$b; done
    OPENAPI_BINS_DIR=\$CARGO_TARGET_DIR/debug bun run gen-api -- --check 2>&1 | tail -15; echo gen-api=\${PIPESTATUS[0]}" 2>&1 | grep -v "Git tree"
  echo "dirty after gen-api: $(git -C $W status --short -- apps/web/src/lib/service-clients | wc -l) files"
  git -C $W status --short -- apps/web/src/lib/service-clients | head -10
done
echo "== done $(date -u +%T)"
