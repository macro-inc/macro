set -euo pipefail
# The $WORKFLOW workflow runs on `pull_request` events. GitHub delivers none
# for a PR that conflicts with its base, and the release job skips fork PRs;
# either way the label did nothing and nobody was told. Say so on the PR and
# take the label off: a release label with no release behind it misleads the
# drift and watch workflows. On a mergeable PR the label did start a release:
# announce it, with the version in flight and the run to watch (the run
# itself comments the outcome when it ends).
announce_release() {
  local since deadline run url conf what steps
  # The release run was created by the same label event as this one, so it
  # exists by now; the window only keeps an older run for the same head (an
  # earlier label add) from being mistaken for it. Runs the release job
  # skipped (another label added at the same time) complete within seconds.
  since=$(date -u -d '-10 minutes' +%FT%TZ)
  deadline=$(( $(date +%s) + 120 ))
  while true; do
    run=$(gh run list --repo "$GH_REPO" --workflow "$WORKFLOW_FILE" --event pull_request --branch "$HEAD_REF" \
      --json databaseId,url,createdAt,headSha,conclusion --limit 10 \
      --jq "[.[] | select(.headSha == \"${HEAD_SHA}\" and .createdAt >= \"${since}\" and .conclusion != \"skipped\")] | first // empty")
    [[ -n "$run" ]] && break
    if (( $(date +%s) > deadline )); then
      gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "⚠️ This PR is mergeable, but no **${WORKFLOW}** run has appeared for it in two minutes. Remove and re-add the \`${LABEL}\` label."
      return 0
    fi
    echo "No ${WORKFLOW} run for ${HEAD_SHA:0:10} yet; waiting."
    sleep 10
  done
  url=$(jq -r '.url' <<<"$run")
  conf=$(gh api "repos/${GH_REPO}/contents/${CONF_PATH}?ref=${HEAD_SHA}" --jq '.content' | base64 --decode)
  if [[ "$LABEL" == ios-update ]]; then
    what="iOS $(jq -r '.version' <<<"$conf") (build $(jq -r '.bundle.iOS.bundleVersion' <<<"$conf"))"
    steps="builds the app, uploads it to TestFlight and submits it for App Review"
  else
    what="Android version code $(jq -r '.bundle.android.versionCode' <<<"$conf")"
    steps="builds the App Bundle, uploads it to the internal track and promotes it to production"
  fi
  gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "🚀 **${WORKFLOW}** started for ${what} at ${HEAD_SHA:0:10} ([workflow run](${url})). It ${steps}, then comments here with the result."
  echo "PR #${PR_NUMBER}: ${WORKFLOW} started for ${what}: ${url}"
}
if [[ "$HEAD_REPO" != "$GH_REPO" ]]; then
  why="this PR comes from a fork (\`${HEAD_REPO}\`), and releases are only built from branches in this repository."
  next="Push the branch to this repository, open a PR from it, and add the \`${LABEL}\` label there."
elif merge=$(pr_merge_commit); then
  echo "PR #${PR_NUMBER} is mergeable (merge result ${merge:0:10}); the ${WORKFLOW} workflow should have started."
  announce_release
  exit 0
elif [[ "$(gh pr view "$PR_NUMBER" --repo "$GH_REPO" --json mergeable --jq '.mergeable')" == "CONFLICTING" ]]; then
  why="this PR has merge conflicts with its base branch, and GitHub does not run \`pull_request\` workflows (the **${WORKFLOW}** workflow among them) on a conflicting PR."
  next="Resolve the conflicts, wait for the checks, then re-add the \`${LABEL}\` label."
else
  # Still UNKNOWN after the helper's polling: GitHub may or may not have run
  # the release. Say so without touching the label — removing it under a
  # release that did start would hide that release from the drift and watch
  # workflows.
  gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "⚠️ GitHub has not worked out whether this PR is mergeable, so it is unclear whether the **${WORKFLOW}** workflow started. If no **${WORKFLOW}** run appears in this PR's checks within a few minutes, remove and re-add the \`${LABEL}\` label."
  exit 0
fi
gh pr edit "$PR_NUMBER" --repo "$GH_REPO" --remove-label "$LABEL"
gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "⚠️ The ${PLATFORM} release did not start: ${why} The \`${LABEL}\` label was removed.

${next}"
echo "PR #${PR_NUMBER}: ${why}"
