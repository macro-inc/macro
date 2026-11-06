set -euo pipefail
# Re-run the $JOB_NAME job of the PR CI run for $HEAD_SHA (waiting for that run
# to finish first: a run in progress saw the labels as they were when it
# started). GitHub re-runs the jobs that depend on it with it, up to the
# CI gate job that sets the required status. A newer CI request starts a fresh
# run that reads the labels itself, and cancels this head's run: nothing to
# re-run then.
current=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json headRefOid --jq '.headRefOid')
if [[ "$current" != "$HEAD_SHA" ]]; then
  echo "PR head moved from ${HEAD_SHA:0:10} to ${current:0:10}; its run reads the labels itself. Nothing to re-run."
  exit 0
fi
deadline=$(( $(date +%s) + 25 * 60 ))
while true; do
  run=$(pr_ci_run "$HEAD_SHA")
  if [[ -z "$run" ]]; then
    echo "No PR CI run for ${HEAD_SHA:0:10} yet; nothing to re-run (the next run reads the current labels)."
    exit 0
  fi
  run_id=$(jq -r '.databaseId' <<<"$run")
  status=$(jq -r '.status' <<<"$run")
  if [[ "$status" == "completed" ]]; then
    if [[ "$(gh run view "$run_id" --repo "$GH_REPO" --json conclusion --jq '.conclusion')" == "cancelled" ]]; then
      echo "Run ${run_id} was cancelled (superseded); nothing to re-run."
      exit 0
    fi
    break
  fi
  if (( $(date +%s) > deadline )); then
    echo "Run ${run_id} is still ${status}; giving up. Re-run the ${JOB_NAME} job by hand." >&2
    exit 1
  fi
  echo "Run ${run_id} is ${status}; waiting for it to finish before re-running the gate."
  sleep 30
done
job_id=$(gh run view "$run_id" --repo "$GH_REPO" --json jobs \
  --jq ".jobs[] | select(.name == \"Web App / ${JOB_NAME}\") | .databaseId")
if [[ -z "$job_id" ]]; then
  echo "Run ${run_id} has no Web App / ${JOB_NAME} job; nothing to re-run."
  exit 0
fi
echo "Re-running ${JOB_NAME} (job ${job_id} of run ${run_id}) with the current labels."
gh run rerun --repo "$GH_REPO" --job "$job_id"
