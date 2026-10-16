set -euo pipefail
# The gate proper: the committed version + build must be live, built from the
# native code of the PR's current merge result. GitHub computes that merge
# commit lazily (mergeable=UNKNOWN until it has), so poll for it a little; a
# PR that really conflicts with main cannot merge anyway.
deadline=$(( $(date +%s) + 120 ))
while true; do
  pr_json=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json mergeable,potentialMergeCommit)
  mergeable=$(jq -r '.mergeable' <<<"$pr_json")
  merge=$(jq -r '.potentialMergeCommit.oid // empty' <<<"$pr_json")
  [[ -n "$merge" ]] && break
  if [[ "$mergeable" == "CONFLICTING" ]]; then
    echo "::error::PR #${PR_NUMBER} conflicts with its base branch, so there is no merge result to check; resolve the conflicts first." >&2
    exit 1
  fi
  if (( $(date +%s) > deadline )); then
    echo "::error::GitHub has not computed PR #${PR_NUMBER}'s merge commit yet (mergeable=${mergeable}); re-run this job in a minute." >&2
    exit 1
  fi
  echo "Merge commit not computed yet (mergeable=${mergeable}); waiting."
  sleep 10
done
native_tree_fetch "$merge"
native_tree=$(native_tree_hash "$merge")
echo "Merge result ${merge:0:10}: native tree ${native_tree}"
bun scripts/ios-app-store.mjs status --require-live --native-tree "$native_tree"
