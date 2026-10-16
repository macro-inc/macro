set -euo pipefail

# Compare against the merge-base so a deleted file still appears. `--no-renames`
# turns a rename into a delete+add pair so the old path is attributed to its
# package (otherwise git reports only the new name).

if [ -z "${GITHUB_BASE_REF:-}" ]; then
  compare_rev="$(git rev-parse HEAD~1)"
else
  git fetch --no-tags origin "$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF"

  # The checkout holds only the PR merge commit and its two parents. Normally
  # the first parent is on the base branch, so the merge-base is immediate.
  # Stacked PRs can arrive with a merge commit built on another branch's tip;
  # deepen the PR side until its history reaches the base branch instead of
  # falling back to the full suite.
  compare_rev=""
  for deepen in 0 200 2000; do
    if [ "$deepen" -gt 0 ]; then
      echo "No merge-base with origin/${GITHUB_BASE_REF} yet; deepening PR history by ${deepen}"
      git fetch --no-tags --deepen="$deepen" origin "$GITHUB_SHA" || break
    fi
    if compare_rev="$(git merge-base "origin/${GITHUB_BASE_REF}" HEAD)"; then
      break
    fi
    compare_rev=""
  done

  if [ -z "$compare_rev" ]; then
    echo "Unable to find merge-base for origin/${GITHUB_BASE_REF}; falling back to full test suite" >&2
    : > /tmp/changed-files
    exit 0
  fi
fi

printf '%s\n' "$compare_rev" > /tmp/base-revision
git diff --name-only --no-renames "$compare_rev" "$GITHUB_SHA" > /tmp/changed-files
