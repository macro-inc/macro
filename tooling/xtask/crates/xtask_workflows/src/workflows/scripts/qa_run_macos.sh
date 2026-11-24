set -uo pipefail

# Runs the harness from the workflow's own commit (checked out beside the tree
# under test), so older refs can be QA'd with today's checks. QA_DMG names the
# release DMG the app came from and adds its notarization checks; QA_ATTEMPTS
# relaunches a failed launch. The `+` expansion keeps an empty array legal
# under `set -u` on Bash before 4.4.
release_args=()
if [ -n "${QA_DMG:-}" ]; then
  release_args+=(--dmg "$QA_DMG")
fi
nix develop --command bun .qa-harness/apps/web/tests/macos/qa.mjs \
  --app "$QA_APP" --out "$QA_OUT" --suite "$QA_SUITE" \
  --ref "$QA_REF" --sha "$QA_SHA" --report "$QA_REPORT" \
  --attempts "${QA_ATTEMPTS:-1}" ${release_args[@]+"${release_args[@]}"}
