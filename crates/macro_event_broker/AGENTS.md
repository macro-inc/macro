# macro_event_broker

## What it is

Belongs to shared infrastructure: a Kafka-backed event broker,
ports-and-adapters style, giving services a typed publish/consume API over
Macro's event topics.

## Start here

- `src/lib.rs`: module-level doc maps the whole crate — `domain::models` for
  `TopicEvent`/`MacroEvent` envelopes, `domain::ports` for `MacroEventBroker`
  (inbound), `EventPublisher`/`EventConsumer`/`Spawner` (outbound), and
  `domain::service` for `MacroEventBrokerService` /
  `MacroEventConsumerService`.
- `src/outbound/kafka_event_publisher.rs`, `kafka_event_consumer.rs`: the
  Kafka adapters (feature `outbound`, via `kafka_util`/`rdkafka`).
- `src/outbound/spawner.rs`: `GlobalSpawner`, the Tokio task-spawning adapter.
- `examples/`: runnable usage examples.

## Scope

- Owns: the publish/consume abstraction and Kafka wiring for Macro's event
  topics.
- Not here: topic definitions (those live in `macro_event_topics`) or
  per-domain event payload shapes (defined by each producing crate).

## Boundaries

- Depends on: `macro_event_topics`, `agent_correlation`, `kafka_util` (optional, feature
  `outbound`).
- Used by: crates and services that publish or consume Macro events
  (`agent_session`, `agent_trigger`, `activity`, `bots`, `calendar_events`,
  `channels`, `chat`, `crm`, `databases`, `documents`, ...).

## Checks

- `cargo test -p macro_event_broker` (`SQLX_OFFLINE` unset).

## Gotchas

- `Event` constructors stamp `agent_correlation_id` and `routine_id` from
  `agent_correlation::context` (omitted from the wire when absent). Build
  events inside the request's task, or `agent_correlation::context::capture`
  the work you spawn; otherwise a routine's own writes can re-trigger it.
- `NoopMacroEventBroker` exists for tests/local configs without Kafka — don't
  reach for a hand-rolled in-memory broker instead.
- Default feature is `outbound`; building without it (e.g. `schema`-only
  consumers of the models) drops the Kafka adapters entirely.

## Related

- Rules: `.agents/rules/rust/architecture.md` (CS-51/CS-52 hexagonal layering)

- Event constructors capture request-local agent correlation and display verb into the envelope; restore both before downstream mutations and capture both before spawning work.
