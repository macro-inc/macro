# bots

## What it is

Part of agent sessions: owns the bot entity itself — models, persistence,
ownership (user or team), and HTTP/AI-tool adapters, plus lifecycle events
for bot mutations that channel bots, agent triggers, and memory build on.

## Start here

- `src/domain/service.rs` + `src/domain/models.rs`: bot CRUD policy and model.
  Team admins may delete team agents; other team bots require the creator or
  team owner.
- `src/domain/events.rs`: `bot.created`/`bot.updated`/`bot.deleted` events published
  to the `macro.bots` Kafka topic (see `README.md` for the wire schema).
- `src/inbound/axum_router.rs`, `src/inbound/channel_webhook_router.rs`,
  `src/inbound/toolset.rs`: HTTP, channel-webhook, and AI-tool adapters.
  `PATCH /agents/{id}` and the `ConfigureAgent` tool share `patch_agent`;
  `PUT` replaces the whole agent, ownership included.
- `src/outbound/pg_bots_repo.rs`: Postgres repository (feature `outbound`).
- `src/domain/profile_fanout.rs`, `src/inbound/profile_consumer.rs`,
  `src/outbound/connection_gateway_profiles.rs` (feature `realtime`, run by
  DSS): push each changed bot's current profile to its owner, team and channel
  members as `bot_profile_changed`, so web views update without a reload.

## Scope

- Owns: bot CRUD, ownership (user or team), bot lifecycle events, and the
  profile push to web clients.
- Not here: agent sessions, channel message triggers, or trigger detection →
  `crates/agent_session`, `crates/channel_bots`.

## Boundaries

- Depends on: `channels` (inbound, optional), `entity_access`, `entity_registry`,
  `messages`, `macro_event_broker`/`macro_event_topics`, `macro_authorization`,
  `connection_gateway_client` and `kafka_util` (`realtime`).
- Used by: `memory`, `ai_tools`, `agent_trigger`, `complete_graph`, `agent_session`.

## Recipes

- Add a bot field or mutation: `src/domain/models.rs` → `src/domain/service.rs`
  → `src/outbound/pg_bots_repo.rs` → `src/inbound/axum_router.rs` → emit/update
  the matching event in `src/domain/events.rs` if it changes mutable state.
- Add an AI tool over bots: `src/inbound/toolset.rs` (feature `ai_tools`).

## Checks

- `cargo test -p bots --features realtime` (`SQLX_OFFLINE` unset).

## Gotchas

- Agent create/update/patch must persist `has_agent = true` atomically with
  configuration writes; mention dispatch gates on this flag for every harness.
- Kafka events key on the bot's bare UUID (no `bot|` prefix); `bot.updated`
  metadata describes the requested PATCH, not a full snapshot — an omitted
  field serializes as `null` (see `README.md`). Consumers that need the bot's
  state read it, as the profile push does.
- A new way a bot's name or picture becomes visible to more people (a new
  surface or audience) must be added to `bot_audience`, or those viewers miss
  live updates.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
- Docs: [`docs/guides/bots.md`](../../docs/guides/bots.md) (setting up a bot
  in the app and using it from the SDK)
