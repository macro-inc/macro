# kafka_util

## What it is

Shared environment-aware Kafka transports: plaintext locally, MSK IAM in hosted
environments, with trace propagation and typed grouped/ungrouped consumers.

## Start here

- `src/lib.rs`: group markers, assignment, publish/receive and configuration.
- `src/msk_iam.rs`: OAuth token refresh; statistics observers must preserve it.
- `src/statistics.rs`: opt-in callbacks for ungrouped consumers, without changing
  assignment or commit behavior. Observers must not block or log raw statistics.

## Scope

- Owns transport mechanics, not domain event decoding or retry policy.
- `Ungrouped` always uses manual assignment with automatic commits/stores off.
- Used by `macro_event_broker` and other domain Kafka adapters.

## Checks

- `cargo test -p kafka_util` (`SQLX_OFFLINE` unset).
- The in-process librdkafka mock broker test verifies statistics and uncommitted
  application offsets; no external Kafka/Docker setup is needed.

## Gotchas

- Statistics callbacks run while polling, not independently of consumption.
  Health reporters must detect stale samples rather than repeating old zero lag.
- Consumer-group lag cannot describe an ungrouped consumer; use application
  positions and explicitly handle unknown offsets and prefetched records.
