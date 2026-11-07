# agent_changes

## What it is

Part of agent sessions: after each turn, reviews the GitHub pull request
linked to a coding-agent session and captures per-file diff facts, the
patch, and a summary, so the harness and its UI can show what changed
without re-reading the repo.

## Start here

- `src/domain/service.rs`: capture flow — reads the PR through a port,
  derives file facts, stores the patch (S3) and summary (Postgres).
- `src/domain/ports.rs`: `PullRequestReader` and the storage ports the
  service depends on.
- `src/inbound/`: HTTP handlers taking session access receipts.
- `src/outbound/`: S3 patch storage, Postgres summary storage, GitHub token
  adapter.

## Scope

- Owns: deriving and storing a session's PR change summary and patch.
- Not here: whether the caller may see the session or repo — checked by the
  owning GitHub token service before this crate is reached.

## Boundaries

- Depends on: `agent_session`, `agent_fold`, `entity_access`, `git_patch`,
  `github_pull_requests`, `teams`.
- Used by: `agent_harness_service` (full), `document_storage_service`
  (`outbound` only, for the capture-after-turn path).

## Recipes

- Add a derived file fact: `src/domain/service.rs` (derivation) →
  `src/domain/model.rs` (shape) → Postgres summary schema in
  `src/outbound/` migrations.

## Checks

- `cargo test -p agent_changes` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
