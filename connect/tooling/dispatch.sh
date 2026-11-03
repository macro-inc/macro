#!/usr/bin/env bash
# Dispatch a Macro Connect task spec to a builder (GPT-6-Sol, Fast tier, via
# Codex) in its own worktree and branch. See connect/docs/building.md.
#
# Usage: connect/tooling/dispatch.sh connect/tasks/T001-slug.md [base-ref]
# Run again on the same spec to resume in the existing worktree after adding a
# "Review (planner)" section to the spec there.
#
# Environment:
#   CONNECT_WORKTREES          where worktrees go (default: <repo>/../connect-worktrees)
#   CONNECT_CARGO_TARGET_DIR   shared cargo target dir the builder may write
#   CONNECT_DATABASE_URL       migrated local Postgres for SQLx macros
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
spec="$(realpath --relative-to="$root" "$1")"
base="${2:-HEAD}"
id="$(basename "$spec" .md)"
worktrees="${CONNECT_WORKTREES:-$root/../connect-worktrees}"
dir="$worktrees/$id"

[[ -d "$dir" ]] || git -C "$root" cat-file -e "$base:$spec" || {
  echo "$spec is not committed at $base; commit the spec before dispatching" >&2
  exit 1
}
prompt_tail=""
if [[ -d "$dir" ]]; then
  # Resume: the builder continues in its existing worktree after the planner
  # added a "Review (planner)" section to the spec there.
  prompt_tail=" You already worked on this task in this worktree (the uncommitted changes are yours). Apply the spec's \"Review (planner)\" section, finish, and replace the Result with final outcomes."
else
  mkdir -p "$worktrees"
  git -C "$root" worktree add -b "connect/$id" "$dir" "$base"
fi

writable=()
if [[ -n "${CONNECT_CARGO_TARGET_DIR:-}" ]]; then
  writable=(-c "sandbox_workspace_write.writable_roots=[\"$CONNECT_CARGO_TARGET_DIR\"]")
fi

CONNECT_CARGO_TARGET_DIR="${CONNECT_CARGO_TARGET_DIR:-$dir/target}" \
CONNECT_DATABASE_URL="${CONNECT_DATABASE_URL:-}" \
codex exec \
  -m gpt-6-sol -c 'service_tier="priority"' \
  -s workspace-write -c sandbox_workspace_write.network_access=true \
  "${writable[@]}" \
  -C "$dir" --json \
  "$(cat "$root/connect/tooling/builder-brief.md") $spec$prompt_tail" \
  >>"$dir.log" 2>&1

echo "builder finished: branch connect/$id, log $dir.log"
