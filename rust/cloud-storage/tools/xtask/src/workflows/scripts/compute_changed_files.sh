set -euo pipefail

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

git diff --name-only "$compare_rev" "$GITHUB_SHA" > /tmp/changed-files
