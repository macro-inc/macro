# soup_realtime_outbound

## What it is

Part of the Soup query feature (Home/Recent/Signal): the adapters behind
`soup_realtime_core`'s ports.

## Start here

- `src/kafka_publisher.rs`: publishes recipient-targeted patches to
  `macro.soup`.
- `src/entity_access.rs`: expands an entity to the users who can see it now.
- `src/agent_sessions.rs`: pull-request session lookups and
  `SoupWorkRegistrationSignal`, which the harness uses to patch registered
  work.
- `src/soup_consumer.rs` (feature `consumer`): `SoupTopicConsumer`, the
  Kafka consumer of recipient-targeted patches for local subscriptions.

## Boundaries

- Depends on: `soup_realtime_core`, `agent_session`, `entity_access`
  (ports), `macro_event_broker`; `kafka_util`/`rdkafka` with `consumer`.
- Used by: the composition roots `services/document_storage_service`
  (with `consumer`) and `services/agent_harness_service`.

## Checks

- `cargo test -p soup_realtime_outbound --all-features`
