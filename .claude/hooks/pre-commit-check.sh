#!/bin/bash
# pre-commit-check.sh - Hard gate before git commit (only for agents)
#
# Runs type check, tests, and lint. Blocks commit if any fail.

set -e

echo "Running pre-commit checks..."

# Type check
if ! bun run check:types 2>/dev/null; then
  echo "Type errors found. Cannot commit." >&2
  exit 2
fi

# Tests
if ! bun run test 2>/dev/null; then
  echo "Tests failing. Cannot commit." >&2
  exit 2
fi

# Lint
if ! bun run lint 2>/dev/null; then
  echo "Lint errors found. Cannot commit." >&2
  exit 2
fi

echo "All checks passed."
exit 0
