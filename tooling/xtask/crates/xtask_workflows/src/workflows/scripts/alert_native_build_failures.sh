set -euo pipefail

failed_jobs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID/jobs?per_page=100" --paginate |
  jq -sr --arg workflow "$SOURCE_WORKFLOW" '
    [.[].jobs[]
      | select(.conclusion == "failure" or .conclusion == "timed_out")
      | select(
          if $workflow == "Build Desktop on Tag" then
            .name == "Build AppImage" or .name == "Build macOS DMG"
              or .name == "QA macOS release app"
          elif $workflow == "iOS Preview" then
            .name == "Build iOS simulator app and publish to Appetize"
          elif $workflow == "Release Android App Bundle" then
            .name == "Build signed Android App Bundle"
          else false end
        )
      | .name] | unique | join(", ")
  ')

# A release may fail in a deploy or publish job without a native build failing.
if [[ -z "$failed_jobs" ]]; then
  exit 0
fi

if [[ -z "$MACRO_WEBHOOK_URL" || -z "$MACRO_BOT_TOKEN" ]]; then
  echo 'Configure the Macro Alerts webhook URL and bot token' >&2
  exit 1
fi
run_url="https://github.com/$GITHUB_REPOSITORY/actions/runs/$SOURCE_RUN_ID"
message="🚨 $SOURCE_WORKFLOW build failed on $SOURCE_REF. Failed jobs: $failed_jobs."
if [[ "$failed_jobs" == *"QA macOS release app"* ]]; then
  message="$message The macOS release app failed QA, so this version was not promoted to desktop-stable."
fi
message="$message $run_url"
jq -n --arg content "$message" '{content: $content}' |
  curl --fail-with-body --silent --show-error --retry 3 \
    --header 'Content-Type: application/json' \
    --header "x-macro-channel-bot-token: $MACRO_BOT_TOKEN" \
    --data-binary @- "$MACRO_WEBHOOK_URL"
