# The latest `PR CI` run that ran for commit $1, as {databaseId, status, url},
# or nothing. Every label starts a `PR CI` run, and runs for labels other than
# run-ci skip every job, so only a run whose Start job ran counts.
pr_ci_run() {
  local id
  for id in $(gh api "repos/${GH_REPO}/actions/workflows/pr-ci.yml/runs?head_sha=$1&event=pull_request&per_page=30" \
      --jq '.workflow_runs[].id'); do
    if [[ -n "$(gh api "repos/${GH_REPO}/actions/runs/${id}/jobs" \
        --jq '.jobs[] | select(.name == "Start" and .conclusion != "skipped") | .id')" ]]; then
      gh api "repos/${GH_REPO}/actions/runs/${id}" --jq '{databaseId: .id, status, url: .html_url}'
      return 0
    fi
  done
}
