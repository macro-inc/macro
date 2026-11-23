set -euo pipefail

if [[ "$SOURCE_CONCLUSION" == cancelled ]]; then
  # Only a tag's desktop run gets here. A newer run for the same tag cancels
  # the one it replaces (the workflow's concurrency group); that one reports.
  newer=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$SOURCE_WORKFLOW_ID/runs?branch=$SOURCE_REF&per_page=20" |
    jq --argjson id "$SOURCE_RUN_ID" '[.workflow_runs[] | select(.id > $id)] | length')
  if [[ "$newer" != 0 ]]; then
    echo "A newer run for $SOURCE_REF replaced this one"
    exit 0
  fi
fi

failed_jobs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID/jobs?per_page=100" --paginate |
  jq -sr --arg workflow "$SOURCE_WORKFLOW" '
    [.[].jobs[]
      | select(
          if $workflow == "Build Desktop on Tag" then
            # Every job matters: the publish jobs attach the installers and
            # promote the update feed. A job that ran out of time is cancelled.
            .conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled"
          elif $workflow == "iOS Preview" then
            (.conclusion == "failure" or .conclusion == "timed_out")
              and .name == "Build iOS simulator app and publish to Appetize"
          elif $workflow == "Release Android App Bundle" then
            (.conclusion == "failure" or .conclusion == "timed_out")
              and .name == "Build signed Android App Bundle"
          else false end
        )
      | .name] | unique | join(", ")
  ')
echo "Failed jobs: ${failed_jobs:-none}"

# An iOS or Android release may fail in a deploy or publish job without a
# native build failing.
if [[ -z "$failed_jobs" ]]; then
  exit 0
fi

if [[ -z "$MACRO_WEBHOOK_URL" || -z "$MACRO_BOT_TOKEN" ]]; then
  echo 'Configure the Macro Alerts webhook URL and bot token' >&2
  exit 1
fi
run_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID"
case "$SOURCE_CONCLUSION" in
  cancelled) outcome='was cancelled' ;;
  timed_out) outcome='timed out' ;;
  *) outcome=failed ;;
esac
message="🚨 $SOURCE_WORKFLOW build $outcome on $SOURCE_REF. Failed jobs: $failed_jobs. $run_url"
jq -n --arg content "$message" '{content: $content}' |
  curl --fail-with-body --silent --show-error --retry 3 \
    --header 'Content-Type: application/json' \
    --header "x-macro-channel-bot-token: $MACRO_BOT_TOKEN" \
    --data-binary @- "$MACRO_WEBHOOK_URL"
