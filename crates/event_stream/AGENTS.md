# event_stream

## What it is

Part of event streams (public events through webhooks, SSE and the SDK). The
core both deliveries share: normalization from each event's declared
exposure, filters, the event catalog and OpenAPI union, and the live stream
(`GET /events/stream`, alias `GET /webhook/events/stream`, `GET
/events/catalog`) with cursors over a Redis log.

## How it works

`public-event-log` (grouped Kafka consumer, `inbound/log_writer.rs`) appends
each public event with its audience, plus access invalidations, to the Redis
Stream `events:v1` (1 h, MAXLEN ~1.5M). Every DSS process tails it from `$`
(`outbound/redis_log.rs`) and `domain/fan_out.rs` delivers each entry once:
filter index → resolve the audience once for all matching local streams
(`domain/access.rs`) → per-stream buffer. `domain/stream.rs` replays from a
cursor (SSE `id` = Redis entry id), then goes live, and closes with a control
event (`lagged`, `revoked`, `reset`).

## Start here

- `src/domain/catalog.rs`: `public_event_registry!` — the one registration
  that makes a family public (catalog, wildcards, OpenAPI `WebhookEvent`).
- `src/domain/access.rs`: audience rules per class and the caches.
- `src/domain/stream.rs`: open, replay, live, close.
- `src/topics.rs`: public topics (`DeclaredMacroEvent`), the log's topics
  (`LogMacroEvent`) and `INTERNAL_TOPICS`.

## Scope

- Owns: normalization, filters, catalog/union, webhook lifecycle event types,
  the public event log, fan-out, SSE.
- Not here: webhook CRUD, matching and delivery → `crates/webhook`; the
  exposure vocabulary → `crates/event_exposure`.

## Boundaries

- Depends on: `event_exposure`, `macro_event_broker`, the public producers'
  event crates, `entity_access` (ports), `rate_limit`, `feature_flags`.
- Used by: `crates/webhook`, `services/document_storage_service` (hosts the
  router, writer and fan-out).

## Recipes

- Make a family public: its producer's `exposure()` returns `Public` →
  add its block to `public_event_registry!` → move its topic from
  `INTERNAL_TOPICS` into both `declare_topics!` lists → add its arm in
  `crates/webhook/src/inbound/kafka_consumer.rs` (`ingest_public_event`).
  New families ship `Preview` (flag `public-event-stream`) first.
- New access-changing event: return its `Invalidation` in
  `domain/invalidations.rs`; if its topic is internal, add it to
  `ACCESS_CHANGE_TOPICS` and `LogMacroEvent`.
- New audience class: `event_exposure::Audience` → `domain/access.rs` →
  webhook mapping in `crates/webhook/src/domain/ingestion.rs`.

## Checks

- `cargo nextest run --all-features -p event_stream` (Redis on
  `REDIS_URL`, default `redis://127.0.0.1:6379`, for `outbound::redis_log`).
- `cargo nextest run --all-features -p webhook` when filters, catalog or
  normalization change.

## Gotchas

- Access adapters must not cache: `entity_access`'s 10 s wrappers are
  bypassed (`get_users_by_entity_uncached`, `is_accessor`) so eviction on a
  logged revocation is exact.
- Link-share viewers are never in an audience; a bot listens as its acting
  user and sees `owner`/`recipient` events only if that user owns it.
- Metrics (`src/metrics.rs`, global OTel meter): `events.stream.open`,
  `events.stream.closes{reason}`, `events.stream.fan_out_lag`,
  `events.log.append_lag`, `events.stream.tail_gaps`. No ids as attributes.
- An audience resolution error drops that event for those streams; it never
  closes them. Upstream is at most once (no outbox); SSE is at least once
  within the replay window when the client resumes with its cursor.
- `channel.participant_removed` is `Entity` only (unchanged behaviour of a
  stable event): the removed user no longer has access, so neither streams nor
  webhooks deliver the removal to them. New removal events (such as
  `team.member_removed`) add a `Snapshot` of who was removed.
- A stream re-validates the headers it opened with every 60 s, so an expired
  session closes it as `revoked`; clients reconnect with a fresh credential.
- The writer's kill switch stops every live stream's events, flagged or not
  (the old per-process consumer is gone); webhooks are unaffected.
- Without the flag a stream behaves as before: no cursors, SSE ids are event
  ids, wildcards are literal names, preview events are never delivered.

## Related

- Docs: `crates/webhook/README.md` · `docs/guides/add-kafka-event.md` ·
  Rules: `.agents/rules/observability.md`
