# --- Android Play commit statuses ---------------------------------------------
# Only workflows that run main's copy may sign in to Google Play, so they
# record what they learn as commit statuses on the PR's commits, where the
# PR-side jobs (the merge gate, the drift check) read it:
#
#   android-play/release  set by Android Play Publish on the commit it built:
#                         pending just before the production promotion, then
#                         success or failure.
#   android-play/live     set by Android Release Watch on the PR head once the
#                         release is live on production.
#
# Readers match the descriptions exactly, so they are built only here.
# Needs GH_TOKEN and GH_REPO; pr_commit_statuses also PR_NUMBER.

# android_release_description <version code> <native hash>
android_release_description() {
  printf 'Version code %s (native tree %s)' "$1" "$2"
}

# android_live_description <version code> <native hash> <PR number>
android_live_description() {
  printf 'Version code %s is live on Google Play (native tree %s, PR #%s)' "$1" "$2" "$3"
}

# commit_status <sha> <context>: `<state> <description>` of the commit's latest
# status with that context, or nothing.
commit_status() {
  gh api "repos/${GH_REPO}/commits/$1/status" \
    --jq ".statuses[] | select(.context == \"$2\") | \"\(.state) \(.description)\""
}

# pr_commit_statuses <context>: `<sha> <state> <description>` for each of PR
# #PR_NUMBER's last 100 commits that has a status with that context (its
# latest one), states in lower case like the REST API's.
pr_commit_statuses() {
  gh api graphql -F owner="${GH_REPO%%/*}" -F name="${GH_REPO#*/}" -F pr="$PR_NUMBER" -F context="$1" \
    -f query='query($owner: String!, $name: String!, $pr: Int!, $context: String!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $pr) {
          commits(last: 100) { nodes { commit { oid status { context(name: $context) { state description } } } } }
        }
      }
    }' \
    --jq '.data.repository.pullRequest.commits.nodes[].commit
      | select(.status.context != null)
      | "\(.oid) \(.status.context.state | ascii_downcase) \(.status.context.description)"'
}

# set_commit_status <sha> <context> <state> <description>, linking this run.
set_commit_status() {
  gh api "repos/${GH_REPO}/statuses/$1" -f context="$2" -f state="$3" -f description="$4" \
    -f target_url="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" >/dev/null
}
# ------------------------------------------------------------------------------
