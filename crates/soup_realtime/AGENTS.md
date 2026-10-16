# soup_realtime

## What it is

Part of the Soup query feature (Home/Recent/Signal) — keeps cached Soup
results live by turning document/project/chat/email/channel/property Kafka
events into recipient-targeted Soup patches, and fanning those out to
instance-local, user-keyed subscriptions. No composition root; starts no
tasks itself.

## Start here

- `src/domain/service.rs`: expands current access for an event and publishes
  one `Patch` per recipient to `macro.soup`.
- `src/domain/models.rs` + `src/domain/ports.rs`: the `Patch<Entity>` shape
  and the ports the service depends on.
- `src/inbound/kafka_consumer.rs`: maps each source Kafka event to
  `Patch::Updated`/`Patch::Deleted` (`consumer` feature).
- `src/outbound/soup_consumer.rs`: `SoupRealtimeConsumerService`, consuming
  recipient-targeted patches into per-user subscriptions.
- `src/outbound/kafka_publisher.rs`, `entity_access.rs`, `agent_sessions.rs`:
  the Kafka and access-expansion adapters.

## Scope

- Owns: event → recipient-targeted Soup patch mapping, and local fan-out of
  those patches to subscribers.
- Not here: the Soup query/filter logic itself → `soup`; deciding what's
  filterable/cacheable per entity → `soup_filter_projection`.

## Boundaries

- Depends on: `macro_event_broker`, `macro_event_topics`, `model-entity`,
  `model_owner`; feature-gated: `channels`, `chat`, `documents`, `email`,
  `github_pull_requests`, `initiative`, `properties`, `projects`,
  `system_properties`, `rdkafka` (`consumer`), `agent_session`/`entity_access`
  (`outbound`).
- Used by: `complete_graph`, `graphql_soup`, `work_feed`.

## Recipes

- Add a new source event: `src/inbound/kafka_consumer.rs` (map to `Patch`) →
  `src/domain/service.rs` if access expansion differs → its test in
  `src/inbound/kafka_consumer/test/`.

## Checks

- `cargo test -p soup_realtime` (`SQLX_OFFLINE` unset).

## Gotchas

- Delivery is at least once: offsets commit only after successful fan-out,
  and exhausted retries stop the consumer for supervisor restart — downstream
  consumers must tolerate duplicate patches.
- Property definition/option lifecycle events are intentionally ignored; they
  don't identify every affected entity.
- Channel threads use their containing channel as the access source.

## Related

- `README.md` (same content as above, kept for non-agent readers)
