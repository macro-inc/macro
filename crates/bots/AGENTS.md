# bots

## What it is

Part of agent sessions: owns the bot entity itself — models, persistence,
ownership (user or team), and HTTP/AI-tool adapters, plus lifecycle events
for bot mutations that channel bots, agent triggers, and memory build on.

## Start here

- `src/domain/service.rs` + `src/domain/models.rs`: bot CRUD policy and model.
- `src/domain/events.rs`: `bot.created`/`bot.updated`/`bot.deleted` events published
  to the `macro.bots` Kafka topic (see `README.md` for the wire schema).
- `src/inbound/axum_router.rs`, `src/inbound/channel_webhook_router.rs`,
  `src/inbound/toolset.rs`: HTTP, channel-webhook, and AI-tool adapters.
- `src/outbound/pg_bots_repo.rs`: Postgres repository (feature `outbound`).

## Scope

- Owns: bot CRUD, ownership (user or team), and bot lifecycle events.
- Not here: agent sessions, channel message triggers, or trigger detection →
  `crates/agent_session`, `crates/channel_bots`.

## Boundaries

- Depends on: `channels` (inbound, optional), `entity_access`, `entity_registry`,
  `messages`, `macro_event_broker`/`macro_event_topics`, `macro_authorization`.
- Used by: `memory`, `ai_tools`, `agent_trigger`, `complete_graph`, `agent_session`.

## Recipes

- Add a bot field or mutation: `src/domain/models.rs` → `src/domain/service.rs`
  → `src/outbound/pg_bots_repo.rs` → `src/inbound/axum_router.rs` → emit/update
  the matching event in `src/domain/events.rs` if it changes mutable state.
- Add an AI tool over bots: `src/inbound/toolset.rs` (feature `ai_tools`).

## Checks

- `cargo test -p bots` (`SQLX_OFFLINE` unset).

## Gotchas

- Kafka events key on the bot's bare UUID (no `bot|` prefix); `bot.updated`
  metadata describes the requested PATCH, not a full snapshot — an omitted
  field serializes as `null` (see `README.md`).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
