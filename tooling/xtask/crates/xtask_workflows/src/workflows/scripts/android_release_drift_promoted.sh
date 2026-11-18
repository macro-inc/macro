set -euo pipefail
# Was the stale bundle — version code $VERSION_CODE, released from
# $BEFORE_SHA or an earlier commit of PR #PR_NUMBER — submitted to Google
# Play production? This job runs the PR's code and cannot sign in to Play, so
# it reads the android-play/release status Android Play Publish sets on the
# commit it built: success means submitted, pending or failure that it may
# have been. A publish run still in progress may be promoting right now, so
# wait for it first. Outputs promoted=true|false, or nothing when unknown.
# BEFORE_SHA is checked directly because a force-push drops it from the PR.
deadline=$(( $(date +%s) + 10 * 60 ))
while true; do
  if ! running=$(gh run list --repo "$GH_REPO" --workflow android-play-publish.yml --json status \
    --jq '[.[] | select(.status != "completed")] | length'); then
    echo "Could not list Android Play Publish runs; production status unknown."
    exit 0
  fi
  if [[ "$running" == 0 ]]; then
    break
  fi
  if (( $(date +%s) > deadline )); then
    echo "An Android Play Publish run is still in progress; production status unknown."
    exit 0
  fi
  echo "Waiting for ${running} Android Play Publish run(s) to finish."
  sleep 15
done
if ! before=$(commit_status "$BEFORE_SHA" android-play/release) || ! others=$(pr_commit_statuses android-play/release); then
  echo "Could not read android-play/release statuses; production status unknown."
  exit 0
fi
promoted=false
while read -r sha state description; do
  [[ "$description" == "Version code ${VERSION_CODE} ("* ]] || continue
  echo "${sha:0:10}: android-play/release ${state}: ${description}"
  if [[ "$state" == success ]]; then
    promoted=true
    break
  fi
  promoted=unknown
done < <({ [[ -z "$before" ]] || printf '%s %s\n' "$BEFORE_SHA" "$before"; } && printf '%s\n' "$others")
if [[ "$promoted" == unknown ]]; then
  echo "Android Play Publish may have promoted version code ${VERSION_CODE}: production status unknown."
else
  echo "promoted=${promoted}" >> "$GITHUB_OUTPUT"
  echo "Version code ${VERSION_CODE} submitted to production: ${promoted}."
fi
