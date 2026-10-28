set -euo pipefail
# Last check before submitting for review: the uploaded build must still
# describe the native tree the merge gate will hash — that of the PR's merge
# result — or it could never pass the gate. Two things can move while a build
# runs: the PR head (a native push; the drift workflow withdraws submissions
# after the fact, but better not to submit at all) and main (another iOS PR
# merged). This checkout is the head the run started from.
built_tree=$(native_tree_hash HEAD)
built=$(jq -r '.bundle.iOS.bundleVersion' apps/web/tauri/src-tauri/tauri.ios.conf.json)
bump='doppler run --project ios-release --config prd -- just ios-bump'
head_sha=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json headRefOid --jq '.headRefOid')
if [[ "$head_sha" == "$(git rev-parse HEAD)" ]]; then
  echo "PR head unchanged (${head_sha:0:10}); native tree ${built_tree:0:10} is current."
else
  native_tree_fetch "$head_sha"
  head_tree=$(native_tree_hash "$head_sha")
  if [[ "$head_tree" != "$built_tree" ]]; then
    echo "Native code changed on PR #${PR_NUMBER} while this release was building" \
      "(tree ${built_tree:0:10} → ${head_tree:0:10}). Not submitting the stale build ${built}." >&2
    echo "Bump (${bump}), commit, and re-add the ios-update label to release the current head." >&2
    exit 1
  fi
  echo "PR head moved to ${head_sha:0:10} but its native tree is still ${built_tree:0:10}."
fi
merge=$(pr_merge_commit)
native_tree_fetch "$merge"
merged_tree=$(native_tree_hash "$merge")
if [[ "$merged_tree" != "$built_tree" ]]; then
  echo "iOS native code landed on main while this release was building: the merge result" \
    "(${merge:0:10}) hashes ${merged_tree:0:10}, build ${built} ${built_tree:0:10}. Not submitting a build the merge gate could never accept." >&2
  echo "Merge main into the PR, bump (${bump}), commit, and re-add the ios-update label." >&2
  exit 1
fi
echo "Merge result ${merge:0:10} matches the built native tree (${built_tree:0:10}); submitting."
