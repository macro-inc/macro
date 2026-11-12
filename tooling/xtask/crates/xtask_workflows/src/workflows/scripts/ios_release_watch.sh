set -euo pipefail
# For each open PR labeled `ios-update` (PRS: [{number, sha, merge}]):
#
# 1. Drift: if the PR's in-flight App Store submission was built from native
#    code the PR head no longer has, withdraw it, drop the label and comment —
#    what the `iOS Release Drift` workflow does on push, except GitHub does
#    not run pull_request workflows on a PR that conflicts with main, so a
#    native push to such a PR only gets caught here.
# 2. Ask App Store Connect whether Apple approved the iOS version + build
#    committed at the PR head (held for release, or live), built from the
#    native tree the PR's merge result would have (`merge` is GitHub's test
#    merge commit; the gate hashes the same). When it did, and the PR's latest
#    `iOS Native Check` job (of PR CI or the earlier web workflow) failed — it
#    fails until Apple approves — re-run the run's failed jobs so the gate, and the `CI gate`
#    status that depends on it, go green without anyone clicking "Re-run".
#
# GH_TOKEN needs actions:write + pull-requests:write.
cd apps/web
conf_path="apps/web/tauri/src-tauri/tauri.ios.conf.json"
bump='cd apps/web && doppler run --project ios-release --config prd -- just ios-bump'

rerun_approved_check() {
  local run=$1 number=$2 version=$3 build=$4 run_id status run_url job conclusion job_id reruns
  run_id=$(jq -r '.databaseId' <<<"$run")
  status=$(jq -r '.status' <<<"$run")
  run_url=$(jq -r '.url' <<<"$run")
  if [[ "$status" != "completed" ]]; then
    echo "  CI run ${run_id} is ${status}; skipping"
    return 0
  fi
  job=$(gh run view "$run_id" --json jobs \
    --jq '.jobs[] | select(.name == "Web App / iOS Native Check" or .name == "iOS Native Check") | {id: .databaseId, conclusion}')
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
  # Counted by our own comments per run: the attempt number is shared with
  # label re-runs and "re-run failed jobs" clicks for flaky tests.
  reruns=$(gh pr view "$number" --json comments --jq \
    "[.comments[].body | select(contains(\"Re-ran the **iOS Native Check**\")) | select(contains(\"iOS ${version} (build ${build})\")) | select(contains(\"[run](${run_url})\"))] | length")
  if (( reruns >= 2 )); then
    echo "  iOS Native Check already re-run ${reruns} times and still failing; not re-running again — see ${run_url}"
    return 0
  fi
  # Re-run the failed jobs, not just this one: the CI gate job that sets the
  # required status depends on it from outside the called web workflow.
  echo "  re-running iOS Native Check (job ${job_id} of run ${run_id}; ${reruns} automatic re-runs so far)"
  gh run rerun "$run_id" --failed
  gh pr comment "$number" --body "📱 Apple approved iOS ${version} (build ${build}). Re-ran the **iOS Native Check** ([run](${run_url})); this PR can merge once it passes, and the next prod deploy releases it on the App Store."
}

check_pr() {
  local pr=$1 number sha merge conf version build head_tree native_tree run legacy_run outputs withdrawn held live
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
  held=$(sed -n 's/^held=//p' "$outputs")
  live=$(sed -n 's/^live=//p' "$outputs")
  if [[ "$withdrawn" == "true" || -n "$held" || -n "$live" ]]; then
    gh pr edit "$number" --remove-label ios-update
    if [[ -n "$held" ]]; then
      gh pr comment "$number" --body "📱 Native changes were pushed to this PR after Apple had already approved iOS ${held}. That build is held for release, so it will not go live on its own, but it blocks the next submission: remove it in App Store Connect (Developer Reject). Then bump (\`${bump}\`), commit, push, and re-add \`ios-update\`. The label was removed."
    elif [[ -n "$live" ]]; then
      gh pr comment "$number" --body "🚨 Native changes were pushed to this PR after Apple had already approved iOS ${live}, so that build is (or is about to be) live with native code this PR no longer matches. Bump (\`${bump}\`), commit, re-add the \`ios-update\` label, and ship the follow-up as soon as possible. The label was removed."
    else
      gh pr comment "$number" --body "📱 Native code changed after this PR's App Store release started (the push-time drift check could not run — does the PR conflict with \`main\`?), so the pending App Review submission was withdrawn and the \`ios-update\` label removed. When the PR is ready again, bump (\`${bump}\`; the marketing version stays, the build number moves), commit, push, and re-add \`ios-update\`."
    fi
    echo "PR #${number}: stale submission handled; label removed"
    return 0
  fi

  # 2. Approval check against the merge result.
  if [[ -z "$merge" ]]; then
    echo "PR #${number}: no merge commit (conflicts with main?); cannot check the merge result"
    return 0
  fi
  native_tree_fetch "$merge"
  native_tree=$(native_tree_hash "$merge")
  echo "PR #${number}: iOS ${version} (build ${build}) at ${sha:0:10}, merge-result native tree ${native_tree:0:10}"

  if ! bun scripts/ios-app-store.mjs status --require-approved \
      --version "$version" --build "$build" --native-tree "$native_tree" \
      >"$RUNNER_TEMP/status-${number}.log" 2>&1; then
    echo "  not approved yet:"
    sed 's/^/    /' "$RUNNER_TEMP/status-${number}.log"
    return 0
  fi
  echo "  approved by Apple"

  run=$(pr_ci_run "$sha")
  # Open PRs can still carry failed checks from before the PR CI migration.
  # Check that workflow too, even when a newer PR CI run already passed:
  # GitHub keeps the two sets of check names separately on the same commit.
  legacy_run=$(gh run list --workflow web-app-check-main.yml --commit "$sha" \
    --event pull_request --limit 1 --json databaseId,status,url --jq '.[0] // empty')
  if [[ -z "$run" && -z "$legacy_run" ]]; then
    echo "  no CI run for this commit; skipping"
    return 0
  fi
  while read -r run; do
    rerun_approved_check "$run" "$number" "$version" "$build"
  done < <(printf '%s\n' "$run" "$legacy_run" | jq -cs 'unique_by(.databaseId)[]')
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
