# activity

## What it is

Shared infrastructure behind activity feeds, entity timelines, and
attribution sorts across the product (Soup, Documents, Forms, Databases,
Initiative, and more): one durable `activity_events` row per "a principal
did something to an entity." Domain crates decide what counts as activity
in their own domain; this crate owns the vocabulary, storage, and
distribution.

## Start here

- `src/domain/models.rs`: `Action`, `Activity`, and the `DomainActivity`
  contract every domain crate implements.
- `src/domain/service.rs` + `src/domain/ports.rs`: the ingest/query service
  and the ports it depends on.
- `src/outbound/pg_activity_repo.rs`: the single `activity_events` table.
- `src/inbound/kafka_consumer.rs` + `src/outbound/activity_topic_consumer.rs`:
  generic Kafka consumer wired to per-domain event mappings.

## Scope

- Owns: the `Action` vocabulary, the `Activity`/`ActivityRecord` row shape,
  feeds/timeline/overview queries, and realtime distribution of new activity.
- Not here: deciding what counts as activity in a given domain — each domain
  crate depends on this with `default-features = false` (models only) and
  implements its own event → `DomainActivity` mapping; the hosting service
  declares consumed topics and dispatches.

## Boundaries

- Depends on: `macro_event_broker`, `macro_event_topics`, `channel_sender`,
  `model-entity`, `model_owner`.
- `teammate_feed` (`src/outbound/pg_activity_repo/team_feed.sql`) reads other
  domains' tables to decide in SQL which teammate rows the viewer may see:
  `team_user`, `entity_access`, `comms_channel_participants`, `email_links`,
  `macro_user_links`, `email_threads`, and `call_entities`. It mirrors
  `EntityAccessService::get_users_by_entity`; change both together.
- Used by: most domain crates with activity surfaces (`documents`, `forms`,
  `databases`, `initiative`, `messages`, `channels`, `soup`, `call`, `chat`,
  `work_feed`, `projects`, `github`, `email`, `properties`) and `ai_tools`.

## Recipes

- Add a new activity source in a domain: implement `DomainActivity` for the
  domain's event type → map it in the domain crate's own consumer → register
  the topic in the hosting service's composition root. A new entity type stays
  out of the team feed until `team_feed.sql` gets a visibility case for it.
- Add a feed/timeline query: `src/domain/timeline.rs` or
  `src/domain/overview.rs` → `src/domain/ports.rs` → `src/outbound/pg_activity_repo.rs`.

## Checks

- `cargo test -p activity` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
