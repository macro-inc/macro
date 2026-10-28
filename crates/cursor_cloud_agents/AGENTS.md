# cursor_cloud_agents

## What it is

Part of agent sessions: an ACP agent backed by Cursor cloud agents — one
ACP session is one Cursor *agent*, one `session/prompt` is one Cursor
*run*, and the run's SSE stream is translated into ACP `session/update`
notifications as it arrives.

## Start here

- `src/lib.rs`: the hexagonal layout (`domain`/`api`/`inbound`/`outbound`) —
  read this doc comment first, it's the map.
- `src/domain/translate.rs`: the Cursor→ACP event translation state machine
  (`TranslateMachine`), mirroring `agent_fold`'s `FoldMachine`.
- `src/domain/service.rs`: ties a prompt to a run.
- `src/api.rs` (`src/api/`): the Cursor cloud REST + SSE client.
- `src/inbound/acp.rs`: newline-delimited JSON-RPC ACP adapter (stdio or
  in-process duplex pipe).
- `src/outbound/postgres_journal.rs`: the hosted session journal (Postgres);
  `src/outbound/memory_journal.rs` for standalone/tests.
- `REPLAY.md`: the native journal, recovery, and migration-rollout contract —
  read before touching `domain/journal.rs` or `outbound/postgres_journal.rs`.

## Scope

- Owns: the Cursor REST/SSE client, the Cursor event→ACP translation, the ACP
  JSON-RPC adapter, and (behind the default `postgres` feature) the hosted
  session journal.
- Not here: the per-user Cursor API key and its encryption →
  `crates/cursor_api_key`.

## Boundaries

- Depends on: `cursor_api_key` (indirectly, via callers), `agent_session`
  (`postgres` feature), `agent_runtime_protocol`, `static_file_service_client`.
- Used by: `agent_harness`, `authentication_service`, `agent_harness_service`.

## Recipes

- Handle a new Cursor SSE event kind: `src/domain/event.rs` →
  `src/domain/translate.rs` → add a fixture under `fixtures/` → the snapshot
  tests in `src/replay/test.rs` / `src/inbound/acp/test.rs`.
- Add a Cursor REST call: `src/api.rs` → its submodule under `src/api/` →
  the matching `domain::ports` trait.
- Change journal recovery/replay behavior: read `REPLAY.md` first, then
  `src/domain/journal.rs` → `src/outbound/postgres_journal.rs` → `src/replay.rs`.

## Checks

- `cargo test -p cursor_cloud_agents` (`SQLX_OFFLINE` unset; default features
  include `postgres`).
- `cargo test -p cursor_cloud_agents --no-default-features` for the in-memory
  path only.

## Gotchas

- `REPLAY.md`'s migration-rollout section documents a one-time consolidation
  of four old migrations into `20260906060601_cursor_session_replay`; don't
  reset or DOWN-migrate a database that already has journal history without
  reading it first.
- `#![deny(missing_docs)]` applies to every public item.
- Translation is a pure state machine fed one event at a time — keep new
  logic in `domain/translate.rs`, not in `api.rs` or `inbound/acp.rs`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
