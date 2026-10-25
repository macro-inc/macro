# github

## What it is

Backs the GitHub integration used by agent sessions and document storage:
GitHub account linking, the GitHub App install/webhook sync, and the OAuth
link flow, following the hexagonal architecture pattern.

## Start here

- `src/domain/models.rs`: re-exports pull request domain types from
  `github_pull_requests` alongside this crate's own link/installation/sync
  models — most "GitHub" domain types actually live in that crate.
- `src/inbound/github_sync_router.rs`: GitHub App install redirect, OAuth
  callback, and the webhook handler.
- `src/inbound/pull_request_index_router.rs`: the HTTP surface for indexed PRs.
- `src/outbound/github_sync_client.rs`, `src/outbound/github_auth_client.rs`:
  GitHub's own REST/App API clients.
- `src/outbound/pg_github_repo.rs`, `src/outbound/pg_github_sync_repo.rs`: the
  Postgres adapters for links and sync state.

## Scope

- Owns: account linking (`link` feature), the App installation/webhook sync
  (`sync` feature), and the Axum router/webhook verification for both.
- Not here: the pull request model, merge rules, and PR listing/service →
  `crates/github_pull_requests`, which this crate re-exports and calls into.

## Boundaries

- Depends on: `github_pull_requests` (ports/schema), `foreign_entity`,
  `documents`, `fusionauth`, `connection_gateway_client`, `macro_service_urls`,
  `notification`/`model_notifications`.
- Used by: `agent_harness_service`, `agent_harness`, `agent_egress`,
  `document_storage_service`, `authentication_service`.

## Recipes

- Add a webhook event: `src/inbound/github_sync_router.rs` (dispatch) →
  `src/domain/models.rs` (sync model) → `src/outbound/pg_github_sync_repo.rs`.
- Add a new GitHub API call: `src/outbound/github_sync_client.rs` or
  `github_auth_client.rs` → the domain service that needs it.

## Checks

- `cargo test -p github --all-features` (`SQLX_OFFLINE` unset).
- Start local PostgreSQL and Redis first (`docs/development/database.md`);
  `REDIS_URL` overrides the Redis test endpoint. Keep the token-cache race test
  enabled in CI, which provisions Redis.
- `just check` (from this directory) runs `cargo check --all-features`.

## Gotchas

- Missing FusionAuth identities/grants require reauthentication; infrastructure
  errors remain errors. After OAuth proves GitHub identity, refresh the grant
  before returning an existing link. Reassign every sharer when its grant owner
  is gone, using the old owner as a compare-and-swap condition. Hold the user
  guard then the GitHub account guard through OAuth grant writes and DB changes;
  disconnect follows the same order. Cache tokens by identity and GitHub account.
- Keep lock-pool acquisition and advisory waits bounded at five seconds; only
  the dedicated lock connections use the five-second lock and ten-second
  statement timeouts. Never expire idle transactions while grant writes run.
- Grant replacement is unlink/relink with best-effort restoration. A timeout
  leaves the remote result uncertain; a crash can leave no grant. Preserve
  Macro links so a later verified OAuth attempt can recreate it.

- Webhook signature verification uses `hmac`/`subtle` for constant-time
  comparison — don't swap in a plain `==` when touching
  `github_sync_router.rs`.
- `GithubError::Forbidden`, `SetupUserNotLinked`, and `RepositoryUnavailable`
  all map to the same 403 deliberately — don't let a response distinguish
  "app not installed" from "installed somewhere you have no claim to".

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
