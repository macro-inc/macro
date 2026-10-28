# last_online_tracker

## What it is

Belongs to notifications/presence: tracks each user's last-seen timestamp in
Redis, written off the hot path through a background worker, for presence
and notification decisions.

## Start here

- `src/domain/services.rs`: `LastOnlineService` — `record_last_online`,
  `get_last_online`, `time_since_last_online`.
- `src/inbound.rs`: `LastOnlineWorker` — an mpsc-backed background task that
  batches writes, and `RecordOnDrop`, which fires a best-effort write when a
  guard value drops (e.g. a connection/session going away).
- `src/outbound/redis.rs`, `src/outbound/time.rs`: the `LastOnlineRepo` and
  `SystemTime` port implementations.

## Scope

- Owns: the last-online timestamp per user and its Redis storage.
- Not here: presence/online status derived from this data — that's the
  caller's (`notification`).

## Boundaries

- Depends on: `macro_user_id`, `redis` (via its own client, not
  `macro_redis`).
- Used by: `notification`.

## Checks

- `cargo test -p last_online_tracker` (`SQLX_OFFLINE` unset).

## Gotchas

- `RecordOnDrop::drop` uses `try_send` and only logs on failure — a full
  channel silently drops the update; this is intentional (best-effort, not
  on the hot path), don't "fix" it into a blocking send.

## Related

- Rules: `.agents/rules/rust/architecture.md` (CS-51/CS-52 hexagonal layering)
