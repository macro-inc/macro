set -euo pipefail
# For each open PR labeled `ios-update` (PRS: [{number, sha, merge}]):
#
# 1. Drift: if the PR's in-flight App Store submission was built from native
#    code the PR head no longer has, withdraw it, drop the label and comment —
#    what the `iOS Release Drift` workflow does on push, except GitHub does
#    not run pull_request workflows on a PR that conflicts with main, so a
#    native push to such a PR only gets caught here.
# 2. Ask App Store Connect whether the iOS version + build committed at the
#    PR head is live, built from the native tree the PR's merge result would
#    have (`merge` is GitHub's test merge commit; the gate hashes the same).
#    When it is, and the PR's latest `iOS Native Check` job (of the web app
#    PR checks run) failed — it fails until the release is live — re-run that
#    job so the gate, and the `Web App Status Check` that depends on it, go
#    green without anyone clicking "Re-run".
#
# GH_TOKEN needs actions:write + pull-requests:write.
cd apps/web
conf_path="apps/web/tauri/src-tauri/tauri.ios.conf.json"
bump='cd apps/web && doppler run --project ios-release --config prd -- just ios-bump'

check_pr() {
  local pr=$1 number sha merge conf version build head_tree native_tree run run_id status run_url job conclusion job_id reruns outputs withdrawn live
  number=$(jq -r '.number' <<<"$pr")
  sha=$(jq -r '.sha' <<<"$pr")
  merge=$(jq -r '.merge // empty' <<<"$pr")
  conf=$(gh api "repos/${GH_REPO}/contents/${conf_path}?ref=${sha}" --jq '.content' | base64 --decode)
  version=$(jq -r '.version' <<<"$conf")
  build=$(jq -r '.bundle.iOS.bundleVersion' <<<"$conf")

  # 1. Drift check against the head's native code.
  native_tree_fetch "$sha"
  head_tree=$(native_tree_hash "$sha")
  outputs="$RUNNER_TEMP/withdraw-${number}.out"
  : >"$outputs"
  GITHUB_OUTPUT="$outputs" bun scripts/ios-app-store.mjs withdraw --pr "$number" --unless-tree "$head_tree" \
    >"$RUNNER_TEMP/withdraw-${number}.log" 2>&1 || true
  sed 's/^/  /' "$RUNNER_TEMP/withdraw-${number}.log"
  withdrawn=$(sed -n 's/^withdrawn=//p' "$outputs")
  live=$(sed -n 's/^live=//p' "$outputs")
  if [[ "$withdrawn" == "true" || -n "$live" ]]; then
    gh pr edit "$number" --remove-label ios-update
    if [[ -n "$live" ]]; then
      gh pr comment "$number" --body "🚨 Native changes were pushed to this PR after Apple had already approved iOS ${live}, so that build is (or is about to be) live with native code this PR no longer matches. Bump (\`${bump}\`), commit, re-add the \`ios-update\` label, and ship the follow-up as soon as possible. The label was removed."
    else
      gh pr comment "$number" --body "📱 Native code changed after this PR's App Store release started (the push-time drift check could not run — does the PR conflict with \`main\`?), so the pending App Review submission was withdrawn and the \`ios-update\` label removed. When the PR is ready again, bump (\`${bump}\`; the marketing version stays, the build number moves), commit, push, and re-add \`ios-update\`."
    fi
    echo "PR #${number}: stale submission handled; label removed"
    return 0
  fi

  # 2. Live check against the merge result.
  if [[ -z "$merge" ]]; then
    echo "PR #${number}: no merge commit (conflicts with main?); cannot check the merge result"
    return 0
  fi
  native_tree_fetch "$merge"
  native_tree=$(native_tree_hash "$merge")
  echo "PR #${number}: iOS ${version} (build ${build}) at ${sha:0:10}, merge-result native tree ${native_tree:0:10}"

  if ! bun scripts/ios-app-store.mjs status --require-live \
      --version "$version" --build "$build" --native-tree "$native_tree" \
      >"$RUNNER_TEMP/status-${number}.log" 2>&1; then
    echo "  not live yet:"
    sed 's/^/    /' "$RUNNER_TEMP/status-${number}.log"
    return 0
  fi
  echo "  live on the App Store"

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
    --jq '.jobs[] | select(.name == "iOS Native Check") | {id: .databaseId, conclusion}')
  if [[ -z "$job" ]]; then
    echo "  run ${run_id} has no iOS Native Check job; skipping"
    return 0
  fi
  job_id=$(jq -r '.id' <<<"$job")
  conclusion=$(jq -r '.conclusion' <<<"$job")
  if [[ "$conclusion" == "success" ]]; then
    echo "  iOS Native Check already passed"
    return 0
  fi
  if [[ "$conclusion" != "failure" ]]; then
    echo "  iOS Native Check job concluded ${conclusion}; leaving it alone"
    return 0
  fi
  # If our re-run also fails something else is wrong (the job's log says
  # what), so stop after two rather than retrying every half hour forever.
  # Counted by our own comments: the run's attempt number is shared with
  # label re-runs and "re-run failed jobs" clicks for flaky tests.
  reruns=$(gh pr view "$number" --json comments --jq \
    "[.comments[].body | select(contains(\"Re-ran the **iOS Native Check**\")) | select(contains(\"iOS ${version} (build ${build})\"))] | length")
  if (( reruns >= 2 )); then
    echo "  iOS Native Check already re-run ${reruns} times and still failing; not re-running again — see ${run_url}"
    return 0
  fi
  echo "  re-running iOS Native Check (job ${job_id} of run ${run_id}; ${reruns} automatic re-runs so far)"
  gh run rerun --job "$job_id"
  gh pr comment "$number" --body "📱 iOS ${version} (build ${build}) is live on the App Store. Re-ran the **iOS Native Check** ([run](${run_url})); this PR can merge once it passes."
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
