set -euo pipefail
# The ios-update label means "release this and merge it when Apple approves",
# so refuse to start unless the PR is in a mergeable state: not a draft, and
# every other check on the head commit passing. Pending checks are waited on
# (the label often lands right after a push); anything failing stops the
# release before the long build. Our own checks are excluded: the native
# check is expected to be red until the release is live.
pr_json=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json isDraft,headRefOid)
if [[ "$(jq -r '.isDraft' <<<"$pr_json")" == "true" ]]; then
  echo "PR #${PR_NUMBER} is a draft; mark it ready for review before adding ios-update." >&2
  exit 1
fi
head_sha=$(jq -r '.headRefOid' <<<"$pr_json")
if [[ "$head_sha" != "$HEAD_SHA" ]]; then
  # Pushed since the label event. Web-only commits are fine (they ship over
  # the air after the merge); native ones would make this build stale.
  native_tree_fetch "$head_sha"
  if [[ "$(native_tree_hash "$head_sha")" != "$(native_tree_hash HEAD)" ]]; then
    echo "PR #${PR_NUMBER} got native changes since this run started (${HEAD_SHA:0:10} → ${head_sha:0:10});" \
      "re-add ios-update on the current head." >&2
    exit 1
  fi
  echo "PR #${PR_NUMBER} moved to ${head_sha:0:10} since this run started, but its native code is unchanged; continuing."
fi

# The gate compares the build's stamp with the native tree of the PR's merge
# result, not of its head. A head that lacks iOS native code main gained since
# the PR branched would go through App Review but could never pass the gate.
merge=$(pr_merge_commit)
native_tree_fetch "$merge"
if [[ "$(native_tree_hash "$merge")" != "$(native_tree_hash HEAD)" ]]; then
  echo "PR #${PR_NUMBER}'s merge result (${merge:0:10}) has iOS native code this head lacks: main changed native code since the PR branched." \
    "Merge main into the PR, bump (doppler run --project ios-release --config prd -- just ios-bump), commit, and re-add ios-update." >&2
  exit 1
fi
echo "Native tree matches the merge result ${merge:0:10}."

# Web App Status Check aggregates the gate, so it is red whenever the gate is;
# its other inputs (Typecheck, Test, Build, ...) are separate checks and stay.
# (`gh pr checks` names are job names, not workflow names.)
ours='^(iOS Native Check|Re-run the native check|Web App Status Check|iOS App Store Release|iOS Release Drift|Android Native Check)'
deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
while true; do
  checks=$(gh pr checks "$PR_NUMBER" --repo "$GH_REPO" --json name,bucket \
    | jq -c --arg ours "$ours" '[.[] | select(.name | test($ours) | not)]')
  failing=$(jq -r '[.[] | select(.bucket == "fail" or .bucket == "cancel") | .name] | join(", ")' <<<"$checks")
  pending=$(jq -r '[.[] | select(.bucket == "pending") | .name] | join(", ")' <<<"$checks")
  if [[ -n "$failing" ]]; then
    echo "PR #${PR_NUMBER} has failing checks: ${failing}. Get the PR green, then re-add ios-update." >&2
    exit 1
  fi
  if [[ -z "$pending" ]]; then
    echo "All other checks on ${head_sha:0:10} pass ($(jq 'length' <<<"$checks") checks)."
    exit 0
  fi
  if (( $(date +%s) > deadline )); then
    echo "Checks still pending after ${WAIT_MINUTES} minutes: ${pending}. Re-add ios-update once they pass." >&2
    exit 1
  fi
  echo "Waiting for: ${pending}"
  sleep 60
done
