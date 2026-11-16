set -uo pipefail

# Runs the harness from the workflow's own commit (checked out beside the tree
# under test), so older refs can be QA'd with today's checks.
nix develop --command bun .qa-harness/apps/web/tests/macos/qa.mjs \
  --app "$QA_APP" --out "$QA_OUT" --suite "$QA_SUITE" \
  --ref "$QA_REF" --sha "$QA_SHA" --report "$QA_REPORT"
