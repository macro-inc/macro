# kafka_util

## What it is

Shared environment-aware Kafka transports: plaintext locally, MSK IAM in hosted
environments, with trace propagation and typed grouped/ungrouped consumers.

## Start here

- `src/lib.rs`: group markers, assignment, publish/receive and configuration.
- `src/msk_iam.rs`: OAuth token refresh; statistics observers must preserve it.
- `src/statistics.rs`: opt-in callbacks for ungrouped consumers, without changing
  assignment or commit behavior. Observers must not block or log raw statistics.
- `src/progress.rs`: per-partition position and backlog from a sample, and
  `assess`, whether a consumer is progressing (fresh sample, brokers up,
  partitions caught up or advancing). The webhook stream's heartbeat and the
  notification consumer's health read it.

## Scope

- Owns transport mechanics, not domain event decoding or retry policy.
- `Ungrouped` always uses manual assignment with automatic commits/stores off.
- Used by `macro_event_broker` and other domain Kafka adapters.

## Checks

- `cargo test -p kafka_util` (`SQLX_OFFLINE` unset).
- The in-process librdkafka mock broker tests verify statistics, uncommitted
  application offsets and the bounded prefetch; no external Kafka/Docker setup
  is needed.

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
- An ungrouped consumer assigned at `InitialOffset::Latest` settles on its start
  in the background and can skip a record published right after assignment;
  `assign_topics_from_now` reads the ends before it returns.
- `position` and `cached_watermarks` read the client's own state without a
  broker request, and the fetcher keeps the watermarks current while the
  application is not receiving, so they work where statistics go stale. A
  partition's high watermark stops moving once its prefetch queue is full.
- `KafkaEventProducer::send` records the payload's event type on the
  `kafka.publish` span as `macro.event.type`.
- With `auto.offset.reset` set, librdkafka resets a partition's position after
  an error (out of range, a truncated log, a failing offset query) without
  telling the application; it only logs an `OFFSET` warning. Every consumer counts those in `kafka.consumer.offset_resets`
  (`topic`), which the search freshness monitors read. rust-rdkafka sets
  librdkafka's log level from the `log` crate's (off in tests), so consumer
  configs keep it at warning or above; a lower level hides the reset.
