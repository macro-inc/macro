set -euo pipefail
# For each open PR labeled `android-update` (PRS: [{number, sha, merge}]), ask
# Google Play whether the version code committed at the PR head is live on
# production, built from the Android native code of the PR's merge result
# (`merge` is GitHub's test merge commit; the gate hashes the same). When it
# is, and the PR's latest `Android Native Check` job (of the web app PR checks
# run) failed — it fails until the release is live — re-run that job so the
# gate, and the `Web App Status Check` that depends on it, go green without
# anyone clicking "Re-run". GH_TOKEN needs actions:write + pull-requests:write;
# GOOGLE_PLAY_ACCESS_TOKEN the androidpublisher scope.
cd apps/web
conf_path="apps/web/tauri/src-tauri/tauri.android.conf.json"

check_pr() {
  local pr=$1 number sha merge native_hash version_code run run_id status run_url job conclusion job_id reruns
  number=$(jq -r '.number' <<<"$pr")
  sha=$(jq -r '.sha' <<<"$pr")
  merge=$(jq -r '.merge // empty' <<<"$pr")
  if [[ -z "$merge" ]]; then
    echo "PR #${number}: no merge commit (conflicts with main?); cannot check the merge result"
    return 0
  fi
  version_code=$(gh api "repos/${GH_REPO}/contents/${conf_path}?ref=${sha}" --jq '.content' | base64 --decode | jq -r '.bundle.android.versionCode')
  gh_fetch "$merge"
  native_hash=$(bun scripts/android-native.mjs hash "$merge")
  echo "PR #${number}: Android version code ${version_code} at ${sha:0:10}, merge-result native hash ${native_hash:0:10}"

  if ! bun scripts/android-play-status.mjs --version-code "$version_code" --require-live \
      --native-hash "$native_hash" --pr "$number" >"$RUNNER_TEMP/status-${number}.log" 2>&1; then
    echo "  not live yet:"
    sed 's/^/    /' "$RUNNER_TEMP/status-${number}.log"
    return 0
  fi
  echo "  live on Google Play production"

  run=$(gh run list --workflow web-app-check-main.yml --commit "$sha" \
    --json databaseId,status,url --limit 1 --jq '.[0] // empty')
  if [[ -z "$run" ]]; then
    echo "  no Web App Pr Checks run for this commit; skipping"
    return 0
  fi
  run_id=$(jq -r '.databaseId' <<<"$run")
  status=$(jq -r '.status' <<<"$run")
  run_url=$(jq -r '.url' <<<"$run")
  if [[ "$status" != "completed" ]]; then
    echo "  Web App Pr Checks run ${run_id} is ${status}; skipping"
    return 0
  fi
  job=$(gh run view "$run_id" --json jobs \
    --jq '.jobs[] | select(.name == "Android Native Check") | {id: .databaseId, conclusion}')
  if [[ -z "$job" ]]; then
    echo "  run ${run_id} has no Android Native Check job; skipping"
    return 0
  fi
  job_id=$(jq -r '.id' <<<"$job")
  conclusion=$(jq -r '.conclusion' <<<"$job")
  if [[ "$conclusion" == "success" ]]; then
    echo "  Android Native Check already passed"
    return 0
  fi
  if [[ "$conclusion" != "failure" ]]; then
    echo "  Android Native Check job concluded ${conclusion}; leaving it alone"
    return 0
  fi
  # If our re-run also fails something else is wrong (the job's log says
  # what), so stop after two rather than retrying every half hour forever.
  reruns=$(gh pr view "$number" --json comments --jq \
    "[.comments[].body | select(contains(\"Re-ran the **Android Native Check**\")) | select(contains(\"version code ${version_code}\"))] | length")
  if (( reruns >= 2 )); then
    echo "  Android Native Check already re-run ${reruns} times and still failing; not re-running again — see ${run_url}"
    return 0
  fi
  echo "  re-running Android Native Check (job ${job_id} of run ${run_id}; ${reruns} automatic re-runs so far)"
  gh run rerun --job "$job_id"
  gh pr comment "$number" --body "🤖 Android version code ${version_code} is live on Google Play. Re-ran the **Android Native Check** ([run](${run_url})); this PR can merge once it passes."
}

# One PR's API hiccup must not stop the others from being checked this
# half hour: each PR runs in its own errexit subshell.
failed=0
while read -r pr; do
  set +e
  ( set -e; check_pr "$pr" )
  rc=$?
  set -e
  if (( rc != 0 )); then
    echo "  error while checking PR $(jq -r '.number' <<<"$pr") (exit ${rc}); continuing"
    failed=1
  fi
done < <(jq -c '.[]' <<<"$PRS")
exit $failed
