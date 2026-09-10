set -euo pipefail

# Compare against the merge-base so a deleted file still appears. `--no-renames`
# turns a rename into a delete+add pair so the old path is attributed to its
# package (otherwise git reports only the new name).

if [ -z "${GITHUB_BASE_REF:-}" ]; then
  compare_rev="$(git rev-parse HEAD~1)"
else
  git fetch origin "$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF"
  if ! compare_rev="$(git merge-base "origin/${GITHUB_BASE_REF}" HEAD)"; then
    echo "Unable to find merge-base for origin/${GITHUB_BASE_REF}; falling back to full test suite" >&2
    : > /tmp/changed-files
    exit 0
  fi
fi

printf '%s\n' "$compare_rev" > /tmp/base-revision
git diff --name-only --no-renames "$compare_rev" "$GITHUB_SHA" > /tmp/changed-files
