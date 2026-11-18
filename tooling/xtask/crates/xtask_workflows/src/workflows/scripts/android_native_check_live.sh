set -euo pipefail
# The Android merge gate proper: version code $VERSION_CODE must be live on
# Google Play production, built from the Android native code of PR
# #PR_NUMBER's *current* merge result (fetched through the API: a re-run
# checks out the merge commit of the run's original event, which may predate
# native code landing on main). This job cannot sign in to Play — only
# workflows that run main's copy can — so it reads the `android-play/live`
# status that Android Release Watch sets once the release is live. Any of the
# PR's commits counts: web-only pushes after the release keep it valid, and
# the native hash in the description pins it to this merge result.
merge=$(pr_merge_commit)
gh_fetch "$merge"
native_hash=$(bun scripts/android-native.mjs hash "$merge")
echo "Merge result ${merge:0:10}: Android native hash ${native_hash}"
want=$(android_live_description "$VERSION_CODE" "$native_hash" "$PR_NUMBER")
statuses=$(pr_commit_statuses android-play/live)
while read -r sha state description; do
  if [[ "$state" == success && "$description" == "$want" ]]; then
    echo "${sha:0:10} is marked android-play/live: ${description}."
    exit 0
  fi
done <<<"$statuses"
echo "Android native changes require version code ${VERSION_CODE} to be live on Google Play before merging," \
  "built from native tree ${native_hash}, but no commit of this PR is marked so (android-play/live)." >&2
if [[ -n "$statuses" ]]; then
  echo "android-play/live statuses on this PR's commits:" >&2
  while read -r sha state description; do
    echo "  ${sha:0:10} ${state}: ${description}" >&2
  done <<<"$statuses"
fi
cat >&2 <<'EOF'
  - Not started yet? Add the `android-update` label to the PR to build, upload
    and promote it.
  - Promoted? Wait for Google review; the `Android Release Watch` workflow marks
    the PR and re-runs this check within half an hour of the release.
  - Native code changed since the release (pushed to the PR, or landed on main)?
    Bump (`just android-bump`), commit, re-add `android-update`.
  - If the native change doesn't break the native/web contract, add the
    `skip-android-update` label instead.
EOF
exit 1
