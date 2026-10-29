set -euo pipefail
# The android-update label means "release this and merge it when it is live",
# so refuse to start unless the PR is in a mergeable state: not a draft, the
# Android native code actually changed with a version code bump, and every
# other check on the head commit passing (pending ones are waited on). Our own
# checks are excluded: the native check is expected to be red until the
# release is live.
pr_json=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json isDraft,headRefOid,baseRefOid)
if [[ "$(jq -r '.isDraft' <<<"$pr_json")" == "true" ]]; then
  echo "PR #${PR_NUMBER} is a draft; mark it ready for review before adding android-update." >&2
  exit 1
fi
head_sha=$(jq -r '.headRefOid' <<<"$pr_json")
base_sha=$(jq -r '.baseRefOid' <<<"$pr_json")
if [[ "$head_sha" != "$HEAD_SHA" ]]; then
  # Pushed since the label event. Web-only commits are fine (they ship over
  # the air after the merge); native ones would make this build stale.
  gh_fetch "$head_sha"
  if [[ "$(bun scripts/android-native.mjs hash "$head_sha")" != "$(bun scripts/android-native.mjs hash HEAD)" ]]; then
    echo "PR #${PR_NUMBER} got Android native changes since this run started (${HEAD_SHA:0:10} → ${head_sha:0:10});" \
      "re-add android-update on the current head." >&2
    exit 1
  fi
  echo "PR #${PR_NUMBER} moved to ${head_sha:0:10} since this run started, but its Android native code is unchanged; continuing."
fi

# The version code must be bumped against the base, and something native
# must actually have changed — there is nothing to release otherwise.
gh_fetch "$base_sha"
outputs=$(mktemp)
GITHUB_OUTPUT="$outputs" bun scripts/android-version-check.mjs "$base_sha"
if [[ "$(sed -n 's/^changed=//p' "$outputs")" != "true" ]]; then
  echo "PR #${PR_NUMBER} has no Android native changes against its base; nothing to release (remove the android-update label)." >&2
  exit 1
fi
version_code=$(sed -n 's/^version_code=//p' "$outputs")

# The gate compares the release stamp with the native hash of the PR's merge
# result, not of its head. A head that lacks Android native code main gained
# since the PR branched would be released but could never pass the gate — and
# a Play release cannot be withdrawn. Refuse before the build instead.
merge=$(pr_merge_commit)
gh_fetch "$merge"
if [[ "$(bun scripts/android-native.mjs hash "$merge")" != "$(bun scripts/android-native.mjs hash HEAD)" ]]; then
  echo "PR #${PR_NUMBER}'s merge result (${merge:0:10}) has Android native code this head lacks: main changed native code since the PR branched." \
    "Merge main into the PR, bump (cd apps/web && just android-bump), commit, and re-add android-update." >&2
  exit 1
fi
echo "version_code=${version_code}" >> "$GITHUB_OUTPUT"
echo "Releasing Android version code ${version_code} (native hash matches the merge result ${merge:0:10})."

# (`gh pr checks` names are job names, not workflow names.)
ours='^(Android Native Check|Android Play Release|Re-run the native check|Web App Status Check|Android Release Drift|iOS Native Check)'
deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
while true; do
  checks=$(gh pr checks "$PR_NUMBER" --repo "$GH_REPO" --json name,bucket \
    | jq -c --arg ours "$ours" '[.[] | select(.name | test($ours) | not)]')
  failing=$(jq -r '[.[] | select(.bucket == "fail" or .bucket == "cancel") | .name] | join(", ")' <<<"$checks")
  pending=$(jq -r '[.[] | select(.bucket == "pending") | .name] | join(", ")' <<<"$checks")
  if [[ -n "$failing" ]]; then
    echo "PR #${PR_NUMBER} has failing checks: ${failing}. Get the PR green, then re-add android-update." >&2
    exit 1
  fi
  if [[ -z "$pending" ]]; then
    echo "All other checks on ${head_sha:0:10} pass ($(jq 'length' <<<"$checks") checks)."
    exit 0
  fi
  if (( $(date +%s) > deadline )); then
    echo "Checks still pending after ${WAIT_MINUTES} minutes: ${pending}. Re-add android-update once they pass." >&2
    exit 1
  fi
  echo "Waiting for: ${pending}"
  sleep 60
done
