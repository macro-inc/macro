#!/usr/bin/env bash
# Serve both proof bundles from the gqlchan stack: the branch bundle, plus
# main's files that the branch lacks. Same-name files that differ are served to
# main pages from disk by pw.mjs (MAIN_FILES). Usage: union.sh [restore]
set -euo pipefail
front="${REPO_ROOT:?set REPO_ROOT to the macro checkout}"/infra/local/generated/gqlchan/frontend
b=$HOME/.cache/gqlchan-bundles
if [ "${1:-}" = restore ]; then
  rsync -a --delete "$b/readers/" "$front/"
  echo "restored the readers bundle"; exit 0
fi
rsync -a --delete --exclude .proof-commit "$b/proof-branch/" "$front/"
rsync -a --ignore-existing --exclude .proof-commit "$b/proof-main/" "$front/"
echo "union: $(find "$front" -type f | wc -l) files; branch $(cat "$b/proof-branch/.proof-commit" | cut -c1-11), main $(cat "$b/proof-main/.proof-commit" | cut -c1-11)"
