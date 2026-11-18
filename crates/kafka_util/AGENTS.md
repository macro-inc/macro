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
- A grouped consumer reads all its partitions from one local queue, and
  librdkafka's queue limits apply to that queue as a whole. With the defaults a
  backlogged partition puts up to 100,000 records ahead of every other
  partition's; `GroupName::PREFETCH` bounds it per group. A bounded queue also
  caps how fast quick records drain, about one fetch per partition per
  `BOUNDED_FETCH_QUEUE_BACKOFF_MS`, and a record batch larger than the fetch
  size is still fetched whole.
- Consumer-group lag cannot describe an ungrouped consumer; use application
  positions and explicitly handle unknown offsets and prefetched records.
