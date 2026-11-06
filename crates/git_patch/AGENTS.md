# git_patch

## What it is

Shared infrastructure for the agent sessions and GitHub integration features:
parses git-style unified diffs into per-file facts, cuts them to a size
budget, and builds the changeset-summary types both agent session changes
and GitHub pull request changes read through, so a client sees the same
status/line counts whichever produced the patch.

## Start here

- `src/patch.rs`: `parse_git_patch`, `budget_patch`, and the byte-budget
  constants (`MAX_PATCH_BYTES`, `MAX_FILE_PATCH_BYTES`).
- `src/model.rs`: `ChangedFile`, `FileChangeKind`, `ChangesetRange`, `GitRef`.
- `src/wire.rs`: the wire/schema (`utoipa`, behind the `schema` feature) shape
  for the summary a client decodes.

## Scope

- Owns: diff parsing and budgeting, and the changeset summary wire types.
- Not here: where the diff comes from (git CLI, GitHub API) or what stores it
  → `crates/github_pull_requests`, `crates/agent_changes`.

## Boundaries

- Depends on: nothing Macro-specific.
- Used by: `github_pull_requests`, `agent_changes`.

## Checks

- `cargo test -p git_patch`.

## Gotchas

- `budget_patch` truncates per-file and overall — a parser change that
  reorders when budgeting runs can silently change what a client sees as
  "truncated" vs. complete.

## Related

- Rules: `.agents/rules/rust/code.md`
