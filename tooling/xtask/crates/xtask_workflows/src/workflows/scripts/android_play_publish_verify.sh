set -euo pipefail
# Android Play Publish runs main's copy for every completed Android Play
# Release run. That run executed the PR's own copy of the workflow, so its
# name, artifact and outcome prove nothing on their own: any PR can add a
# workflow named "Android Play Release" that runs on any event. Publish only
# a build that the `android-update` label started — the label is the release
# decision — by checking, with GitHub's records rather than the run's:
#
#   1. it ran the release workflow file and its release job succeeded;
#   2. its branch is the head of exactly one open same-repository PR into main;
#   3. that PR still carries the label, and the label's latest event is an
#      add by a person (not a bot or token) with write access;
#   4. that person started this run, within minutes of adding the label: a
#      run created by a later push, or by an earlier add that a newer one has
#      superseded, is not the run the label asked for.
#
# The head guard (a later step) then checks the PR's native code is still the
# built one. Needs GH_TOKEN, GH_REPO, RUN_ID, RUN_ATTEMPT, RUN_PATH,
# RUN_ACTOR, RUN_CREATED_AT, HEAD_SHA, HEAD_BRANCH, and gh_fetch.
skip() {
  echo "$1"
  echo "publish=false" >> "$GITHUB_OUTPUT"
  exit 0
}
refuse() {
  echo "Not publishing run ${RUN_ID}: $1" >&2
  exit 1
}

if [[ "${RUN_PATH%%@*}" != .github/workflows/android-play-release.yml ]]; then
  skip "Run ${RUN_ID} ran ${RUN_PATH}, not the Android Play Release workflow file; nothing to publish."
fi
build=$(gh api "repos/${GH_REPO}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}/jobs" \
  --jq '[.jobs[] | select(.name == "Android Play Release") | .conclusion] | first // ""')
if [[ "$build" != success ]]; then
  skip "Run ${RUN_ID}'s Android Play Release job did not succeed (${build:-absent}): another label, or a failed build. Nothing to publish."
fi

pr=$(gh pr list --repo "$GH_REPO" --head "$HEAD_BRANCH" --base main --state open \
  --json number,isCrossRepository \
  --jq '[.[] | select(.isCrossRepository == false)] | if length == 1 then .[0].number else "" end')
if [[ -z "$pr" ]]; then
  refuse "branch ${HEAD_BRANCH} is not the head of exactly one open same-repository PR into main."
fi
export PR_NUMBER=$pr
echo "pr_number=${PR_NUMBER}" >> "$GITHUB_OUTPUT"
echo "Run ${RUN_ID} built ${HEAD_SHA:0:10} for PR #${PR_NUMBER}."

if [[ "$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json labels \
  --jq 'any(.labels[]; .name == "android-update")')" != true ]]; then
  refuse "PR #${PR_NUMBER} no longer carries the android-update label."
fi
event=$(gh api --paginate "repos/${GH_REPO}/issues/${PR_NUMBER}/events" \
  --jq '.[] | select((.event == "labeled" or .event == "unlabeled") and .label.name == "android-update")
    | {event, login: .actor.login, type: .actor.type, at: .created_at}' \
  | jq -cs 'sort_by(.at) | last // empty')
if [[ -z "$event" ]]; then
  refuse "PR #${PR_NUMBER} has no android-update label event."
fi
kind=$(jq -r '.event' <<<"$event")
login=$(jq -r '.login' <<<"$event")
type=$(jq -r '.type' <<<"$event")
at=$(jq -r '.at' <<<"$event")
if [[ "$kind" != labeled ]]; then
  refuse "the android-update label was last removed (${at}), not added."
fi
if [[ "$type" != User ]]; then
  refuse "the android-update label was last added by ${login} (${type}); a person with write access must add it."
fi
if [[ "$login" != "$RUN_ACTOR" ]]; then
  refuse "${login} added the android-update label last, but ${RUN_ACTOR} started this run, so this is not the run that label started."
fi
permission=$(gh api "repos/${GH_REPO}/collaborators/${login}/permission" --jq '.permission')
if [[ "$permission" != admin && "$permission" != write ]]; then
  refuse "${login}, who added the android-update label, has ${permission} access; releasing needs write access."
fi
label_epoch=$(jq -rn --arg t "$at" '$t | fromdateiso8601')
run_epoch=$(jq -rn --arg t "$RUN_CREATED_AT" '$t | fromdateiso8601')
if (( run_epoch < label_epoch - 60 || run_epoch > label_epoch + 600 )); then
  refuse "this run was created at ${RUN_CREATED_AT}, but the android-update label was last added at ${at}, so the label did not start it. Re-add the label to release the PR's current head."
fi
echo "${login} (${permission} access) added android-update at ${at} and started this run at ${RUN_CREATED_AT}."

gh_fetch "$HEAD_SHA"
version_code=$(bun scripts/android-native.mjs version-code "$HEAD_SHA")
version=$(git show "${HEAD_SHA}:apps/web/tauri/src-tauri/tauri.android.conf.json" | jq -r '.version')
{
  echo "version_code=${version_code}"
  echo "release_name=${version} (${version_code})"
  echo "publish=true"
} >> "$GITHUB_OUTPUT"
echo "Publishing Android ${version} (version code ${version_code})."
