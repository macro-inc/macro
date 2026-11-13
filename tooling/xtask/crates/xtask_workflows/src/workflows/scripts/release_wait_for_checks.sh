# The last precondition of a store release: every other check on the head
# commit passes. Pending ones are waited on, since the label often lands
# right after a push; a failing one stops the release before the long build.
# Both platforms run this one copy. RELEASE_LABEL names the label in messages.
#
# Checks a release does not wait on, as `gh pr checks` names them: job names,
# not workflow names, plus the contexts of commit statuses such as the
# android-play/* ones. PR CI prefixes the jobs it calls with `Web App / `.
#
# - The native checks are red until the release is live. Web App Status Check
#   and the CI gate aggregate them, so they are red with them. Web App Status
#   Check's other inputs (Typecheck, Test, Build, ...) are separate checks and
#   still count.
# - Both platforms' release and drift checks. The other store's release is
#   not this one's gate: an upload that failed there, or is still in flight,
#   must not hold this release back. Whoever adds the label decides whether a
#   failure there matters here.
release_gate_checks='^((Web App / )?(Android Native Check|iOS Native Check|Web App Status Check)|Re-run the native check|Android Play Release|Android Release Drift|android-play/|iOS App Store Release|iOS Release Drift|CI gate$)'
deadline=$(( $(date +%s) + WAIT_MINUTES * 60 ))
while true; do
  all_checks=$(gh pr checks "$PR_NUMBER" --repo "$GH_REPO" --json name,bucket,description)
  # The checks only exist once someone has run PR CI on this head. Its CI gate
  # fails with the native check, so only the gate's description is read here.
  # Two entries carry that name, the PR CI job and the commit status; only the
  # status has a description, and it stays pending on a head no one has run
  # PR CI on.
  gate=$(jq -r '
    [.[] | select(.name == "CI gate") | .description] as $gates |
    ([$gates[] | select(startswith("Running on") or startswith("Passed on"))][0] //
     [$gates[] | select(startswith("Failed:"))][0] //
     [$gates[] | select(. != "")][0] // "")
  ' <<<"$all_checks")
  case "$gate" in
    "" | "Not run on this commit."*)
      echo "CI has not run on ${head_sha:0:10}. Run it (gh api repos/${GH_REPO}/issues/${PR_NUMBER}/labels -f "labels[]=run-ci"), then re-add ${RELEASE_LABEL} once it passes." >&2
      exit 1
      ;;
    "Running on"* | "Passed on"* | "Failed:"*) ;;
    *)
      echo "CI could not run on ${head_sha:0:10}: ${gate}. Re-add ${RELEASE_LABEL} once it passes." >&2
      exit 1
      ;;
  esac
  checks=$(jq -c --arg ignored "$release_gate_checks" '[.[] | select(.name | test($ignored) | not)]' <<<"$all_checks")
  if [[ "$gate" == "Running on"* ]]; then
    checks=$(jq -c '. + [{name: "CI gate", bucket: "pending"}]' <<<"$checks")
  fi
  failing=$(jq -r '[.[] | select(.bucket == "fail" or .bucket == "cancel") | .name] | join(", ")' <<<"$checks")
  pending=$(jq -r '[.[] | select(.bucket == "pending") | .name] | join(", ")' <<<"$checks")
  if [[ -n "$failing" ]]; then
    echo "PR #${PR_NUMBER} has failing checks: ${failing}. Get the PR green, then re-add ${RELEASE_LABEL}." >&2
    exit 1
  fi
  if [[ -z "$pending" ]]; then
    echo "All other checks on ${head_sha:0:10} pass ($(jq 'length' <<<"$checks") checks)."
    exit 0
  fi
  if (( $(date +%s) > deadline )); then
    echo "Checks still pending after ${WAIT_MINUTES} minutes: ${pending}. Re-add ${RELEASE_LABEL} once they pass." >&2
    exit 1
  fi
  echo "Waiting for: ${pending}"
  sleep 60
done
