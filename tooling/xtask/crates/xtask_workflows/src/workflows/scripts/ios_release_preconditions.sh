set -euo pipefail
# The ios-update label means "release this and merge it when Apple approves",
# so refuse to start unless the PR is in a mergeable state: not a draft, and
# every other check on the head commit passing. Pending checks are waited on
# (the label often lands right after a push); anything failing stops the
# release before the long build. The native checks and both platforms'
# release checks are excluded; that last step is release_wait_for_checks.sh.
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
if ! merge_result_native_check native_tree_hash native_tree_listing native_tree_fetch; then
  echo "A build from this head could never pass the merge gate. Merge ${BASE_BRANCH} into the PR," \
    "bump (doppler run --project ios-release --config prd -- just ios-bump), commit, and re-add ios-update." >&2
  exit 1
fi
