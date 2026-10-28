# --- PR merge result ----------------------------------------------------------
# pr_merge_commit: print the sha of GitHub's test merge commit for $PR_NUMBER —
# the merge result the native gates hash. GitHub computes it lazily
# (mergeable=UNKNOWN until it has), so poll a little; a PR that really
# conflicts with its base cannot merge anyway. Needs GH_TOKEN, GH_REPO,
# PR_NUMBER. Progress goes to stderr so `merge=$(pr_merge_commit)` works.
pr_merge_commit() {
  local deadline pr_json mergeable merge
  deadline=$(( $(date +%s) + 120 ))
  while true; do
    pr_json=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json mergeable,potentialMergeCommit)
    mergeable=$(jq -r '.mergeable' <<<"$pr_json")
    merge=$(jq -r '.potentialMergeCommit.oid // empty' <<<"$pr_json")
    if [[ -n "$merge" ]]; then
      echo "$merge"
      return 0
    fi
    if [[ "$mergeable" == "CONFLICTING" ]]; then
      echo "::error::PR #${PR_NUMBER} conflicts with its base branch, so there is no merge result to check; resolve the conflicts first." >&2
      return 1
    fi
    if (( $(date +%s) > deadline )); then
      echo "::error::GitHub has not computed PR #${PR_NUMBER}'s merge commit yet (mergeable=${mergeable}); retry in a minute." >&2
      return 1
    fi
    echo "Merge commit not computed yet (mergeable=${mergeable}); waiting." >&2
    sleep 10
  done
}
# ------------------------------------------------------------------------------
