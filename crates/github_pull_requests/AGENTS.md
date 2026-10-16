# github_pull_requests

## What it is

Backs the GitHub integration's pull request surface (agent session
changesets and PR review): the PR model, stored as `foreign_entity` records,
the rules for merging refreshed GitHub data, and the service that writes and
lists visible PRs.

## Start here

- `src/domain/service.rs`: submodules `index` (write/list/refresh) and
  `changes` (`GithubPullRequestChangesServiceImpl` — the diff/changeset path
  agent sessions use).
- `src/domain/models.rs`: the PR model and merge rules for refreshed data.
- `src/broker.rs`: event broker wiring for PR update events.
- `src/outbound/pg_github_pull_request_repo.rs`: the typed-column Postgres
  adapter over `foreign_entity`'s generic storage.
- `src/outbound/s3_patch_store.rs`: diff/patch storage in S3 (`s3` feature).

## Scope

- Owns: the PR domain model, merge-on-refresh semantics, PR listing/filtering,
  and the changeset/diff path.
- Not here: GitHub App auth, webhook receipt, and account linking →
  `crates/github`, which depends on this crate, not the reverse.

## Boundaries

- Depends on: `foreign_entity` (ports/outbound), `git_patch` (diff parsing/schema).
- Used by: `github` (re-exports this crate's models), `soup`, `soup_realtime`,
  `agent_changes`, `ai_tools`, `memory`, `document_storage_service`,
  `document_cognition_service`, `authentication_service`, `mcp_service`,
  `agent_harness_service`.

## Recipes

- Add a typed PR column: `src/domain/models.rs` → `src/outbound/pg_github_pull_request_repo.rs`
  → the merge rule in `src/domain/models.rs` that decides how it's refreshed.
- Add a changeset/diff capability: `src/domain/service.rs` (`changes` module)
  → `src/outbound/s3_patch_store.rs` → `git_patch` if the diff shape changes.

## Checks

- `cargo test -p github_pull_requests --all-features` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
