set -euo pipefail
# Re-run the `iOS Native Check` job of the web app PR checks run for
# $HEAD_SHA (waiting for that run to finish first: a run in progress saw the
# labels as they were when it started). GitHub re-runs the dependent
# `Web App Status Check` with it.
# A push after the label event starts a fresh run that reads the labels
# itself, and would also have cancelled this head's run (the web suite
# cancels in-progress runs per PR): nothing to re-run then.
current=$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json headRefOid --jq '.headRefOid')
if [[ "$current" != "$HEAD_SHA" ]]; then
  echo "PR head moved from ${HEAD_SHA:0:10} to ${current:0:10}; its run reads the labels itself. Nothing to re-run."
  exit 0
fi
deadline=$(( $(date +%s) + 25 * 60 ))
while true; do
  run=$(gh run list --repo "$GH_REPO" --workflow web-app-check-main.yml --commit "$HEAD_SHA" \
    --json databaseId,status,conclusion --limit 1 --jq '.[0] // empty')
  if [[ -z "$run" ]]; then
    echo "No Web App Pr Checks run for ${HEAD_SHA:0:10} yet; nothing to re-run (the next push runs the gate with the current labels)."
    exit 0
  fi
  run_id=$(jq -r '.databaseId' <<<"$run")
  status=$(jq -r '.status' <<<"$run")
  if [[ "$status" == "completed" ]]; then
    if [[ "$(jq -r '.conclusion' <<<"$run")" == "cancelled" ]]; then
      echo "Run ${run_id} was cancelled (superseded); nothing to re-run."
      exit 0
    fi
    break
  fi
  if (( $(date +%s) > deadline )); then
    echo "Run ${run_id} is still ${status}; giving up. Re-run the iOS Native Check job by hand." >&2
    exit 1
  fi
  echo "Run ${run_id} is ${status}; waiting for it to finish before re-running the gate."
  sleep 30
done
job_id=$(gh run view "$run_id" --repo "$GH_REPO" --json jobs \
  --jq '.jobs[] | select(.name == "iOS Native Check") | .databaseId')
if [[ -z "$job_id" ]]; then
  echo "Run ${run_id} has no iOS Native Check job; nothing to re-run."
  exit 0
fi
echo "Re-running iOS Native Check (job ${job_id} of run ${run_id}) with the current labels."
gh run rerun --repo "$GH_REPO" --job "$job_id"
