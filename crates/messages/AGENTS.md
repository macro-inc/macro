# messages

## What it is

The messaging/discussions feature: anchored discussions on channels and
documents. This domain crate owns the models, authorization, and the
HTTP/Postgres/delivery adapters, feature-gated so callers pull in only what
they need.

## Start here

- `src/domain/models.rs`: shared message/thread models.
- `src/domain/service.rs` + `src/domain/ports.rs`: use-case orchestration and
  the repository/delivery ports (feature `ports`).
- `src/domain/api.rs`: `MessageServiceApi`, the boundary HTTP/agents/channel
  adapters call through.
- `src/inbound/axum_router.rs`: the HTTP surface (feature `inbound`).
- `src/outbound/pg_message_repo.rs` + `pg_discussion_context.rs`: Postgres
  adapters (feature `outbound`).
- `src/outbound/connection_gateway.rs`, `notification_sender.rs`, `broker.rs`:
  realtime/notification delivery adapters (features `outbound`/`broker`).

## Scope

- Owns: message and discussion domain logic, mentions, notification policy
  for messages, and their delivery/storage adapters.
- Not here: channel membership and chat domain logic → `channels`, `chat`;
  who gets notified in general → `model_notifications`.

## Boundaries

- Depends on (by feature): `entity_access` (ports/inbound), `model` (annotations),
  `properties`/`models_properties`/`model_notifications`/`notification`
  (delivery), `initiative` (outbound), `macro_event_broker`/`macro_event_topics`
  (broker).
- Used by: `agent_harness`, `agent_session`, `agent_trigger`, `ai_tools`, `bots`,
  `channel_bots`, `channels`, `coding_agent_worker`, `crm`, `documents`,
  `lexical_client`, `lexical_mention_extractor`, `macro_db_client`,
  `soup_realtime`, `webhook`.

## Recipes

- Add a message use case: `src/domain/ports.rs` (port) → `src/domain/service.rs`
  → `src/domain/api.rs` → `src/inbound/axum_router.rs`.
- Add a delivery channel: `src/domain/delivery.rs` → new adapter under
  `src/outbound/` → feature-gate it in `Cargo.toml`.

## Checks

- `cargo test -p messages --all-features` (`SQLX_OFFLINE` unset).

## Gotchas

- Most modules are feature-gated (`annotations`, `broker`, `delivery`,
  `inbound`, `outbound`, `ports`, `schema`); a caller enabling the wrong
  combination gets a missing-module compile error, not a runtime one — check
  `Cargo.toml`'s `[features]` table before adding a dependency edge.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md` ·
  Skill: `collab-surface-core`
