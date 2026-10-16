# memory

## What it is

Part of agent sessions. Generates and stores a per-user AI memory (a
free-text summary an agent can load as context) by running the agent loop
over that user's own tools.

## Start here

- `src/main.rs`: CLI entrypoint — loads one user id from env, generates and
  stores their memory, waits for the event broker to drain, exits.
- `src/domain/service.rs` + `src/domain/ports.rs`: `MemoryServiceImpl`,
  `MemoryRepo` port, and `MemoryError`.
- `src/inbound/axum_router.rs`: the HTTP read path, mounted by callers that
  need an existing memory record rather than generating one.
- `src/outbound/pg_memory_repo.rs`: the Postgres adapter.
- `src/context.rs`: builds the `ToolServiceContext` used to run the agent loop.

## Scope

- Owns: memory generation (prompting the agent with the user's tools),
  storage, and the read router.
- Not here: the agent loop itself → `agent`; AI billing/usage enforcement →
  `ai_billing`, `ai_usage`.

## Boundaries

- Depends on: `agent`, `ai_tools`, `ai_toolset`, `ai_billing`, `ai_usage`,
  `macro_authorization`, and the large "ToolServiceContext" dependency set in
  `Cargo.toml` (most domain crates with AI tools).
- Used by: `agent_inmem` (reads memory into agent context),
  `document_cognition_service`.

## Recipes

- Change what the generation prompt covers: `src/domain/service.rs` →
  `src/context.rs` (tool context) → `src/main.rs`.
- Add a read endpoint: `src/inbound/axum_router.rs` → `src/domain/ports.rs`
  (`MemoryRepo`) → `src/outbound/pg_memory_repo.rs`.

## Checks

- `cargo test -p memory` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
