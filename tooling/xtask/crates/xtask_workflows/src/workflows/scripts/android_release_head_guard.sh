set -euo pipefail
# Last check before uploading: the bundle must still describe the native code
# the merge gate will hash — that of the PR's merge result — or it could never
# pass the gate, and a promoted Play release cannot be withdrawn. Two things
# can move while a build runs: the PR head (a native push; the drift workflow
# cancels runs after the fact, but better not to upload at all) and main
# (another Android PR merged).
built=$(bun scripts/android-native.mjs hash HEAD)
head_sha=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json headRefOid --jq '.headRefOid')
if [[ "$head_sha" == "$(git rev-parse HEAD)" ]]; then
  echo "PR head unchanged (${head_sha:0:10}); native hash ${built:0:10} is current."
else
  gh_fetch "$head_sha"
  current=$(bun scripts/android-native.mjs hash "$head_sha")
  if [[ "$current" != "$built" ]]; then
    echo "Android native code changed on PR #${PR_NUMBER} while this release was building" \
      "(${built:0:10} → ${current:0:10}). Not uploading the stale bundle." >&2
    echo "Re-add the android-update label to release the current head." >&2
    exit 1
  fi
  echo "PR head moved to ${head_sha:0:10} but its Android native code is unchanged (${built:0:10})."
fi
if ! merge_result_native_check "bun scripts/android-native.mjs hash" "bun scripts/android-native.mjs listing" gh_fetch; then
  echo "Android native code landed on ${BASE_BRANCH} while this release was building. Not uploading the bundle" \
    "(native hash ${built:0:10}): the merge gate could never accept it." >&2
  echo "Merge ${BASE_BRANCH} into the PR, bump (cd apps/web && just android-bump), commit, and re-add the android-update label." >&2
  exit 1
fi
echo "Uploading the bundle (native hash ${built:0:10})."
