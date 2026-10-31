# stream

## What it is

Shared infrastructure — a Redis Streams abstraction (typed append/read/ack
over `model-entity` payloads) for services that want an ordered,
consumer-group event log without a full Kafka dependency.

## Start here

- `src/domain/traits.rs`: the stream port(s) consumers implement against.
- `src/domain/types.rs`: stream entry and cursor types.
- `src/outbound/mod.rs`: the Redis-backed adapter.
- `src/bin/stream_stdin.rs`: a CLI for piping stdin lines onto a stream, handy
  for manual testing against a local Redis.

## Scope

- Owns: the Redis Streams read/append/ack contract and its Redis adapter.
- Not here: Kafka topics or `macro_event_broker` — this is for services that
  want an ordered, consumer-group log without a full Kafka dependency.

## Boundaries

- Depends on: `model-entity`, `redis` (streams/aio/tokio-comp).
- Used by: `services/agent_harness_service`, `services/connection_gateway`.

## Checks

- `cargo test -p stream` for unit tests (no Redis required).
- `just crates/stream/test_integration` — starts a local Redis container via
  the `redis-test` feature, for the `#[ignore]`d integration tests.

## Related

- Rules: `.agents/rules/rust/architecture.md`
