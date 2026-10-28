# onboarding

## What it is

Part of the onboarding feature (`/setup`). Tracks one row per user for
whether they are still in the flow, and assembles the state the flow reads
(connected MCP servers, a suggested team domain). Connecting an app during
onboarding does not start an import.

## Start here

- `src/lib.rs`: crate doc comment.
- `src/domain/service.rs` + `src/domain/ports.rs`: flow state transitions and
  the ports they need.
- `src/outbound/pg_onboarding_repo.rs`: the single Postgres adapter.
- `src/inbound/axum_router.rs`: the `/setup` HTTP routes.

## Scope

- Owns: the per-user onboarding flag/state.
- Not here: importing from connected apps → `import`.

## Boundaries

- Depends on: `mcp_client`, `generic_email_domains`, `macro_authorization`.
- Used by: `services/agent_harness_service`,
  `services/authentication_service` (onboarding deletes its row during
  account deletion).

## Checks

- `cargo test -p onboarding` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Gotchas

- Account deletion must delete the `user_onboarding` row explicitly — it is
  not cascaded (see `fix(auth): delete user_onboarding row during account
  deletion`).

## Related

- Rules: `.agents/rules/rust/architecture.md`
