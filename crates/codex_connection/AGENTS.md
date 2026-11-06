# codex_connection

## What it is

Part of agent sessions: owner-bound Codex OAuth connections — durable
device login and encrypted credential storage/rotation for hosted Codex
sessions.

## Start here

- `src/domain.rs` + `src/domain/service.rs`: connection lifecycle policy
  (`ConnectionError`, `ConnectionServiceImpl`) independent of HTTP/Postgres/KMS.
- `src/outbound/postgres.rs`: owner transaction locking and encrypted state
  persistence.
- `src/outbound/cipher.rs`: AWS KMS envelope encryption for OAuth payloads.

## Scope

- Owns: per-owner Codex connection state, login-attempt tracking, and the
  encrypted-at-rest persistence of that state.
- Not here: the OpenAI cloud-task client and ACP session itself →
  `crates/codex_cloud_agents` (this crate depends on it for `CloudId`,
  `Credentials`, `Environment`, `Secret`).

## Boundaries

- Depends on: `codex_cloud_agents` (domain types), `macro_user_id`.
- Used by: `agent_harness`, `authentication_service`, `agent_harness_service`.

## Recipes

- Add a connection-lifecycle rule (e.g. a new error case or transition):
  `src/domain.rs` → `src/domain/service.rs` → its `test.rs`.
- Change persisted connection state: `src/outbound/postgres.rs` →
  `src/outbound/postgres/test.rs` (uses `macro_db_migrator` as a dev-dependency).

## Checks

- `cargo test -p codex_connection` (`SQLX_OFFLINE` unset).

## Gotchas

- `ConnectionError` variants intentionally never carry credentials or
  provider response bodies — don't add an error case that does.
- `#![deny(missing_docs)]` applies to every public item.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`,
  `.agents/rules/rust/security.md`
