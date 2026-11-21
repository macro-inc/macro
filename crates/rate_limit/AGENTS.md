# rate_limit

## What it is

Part of shared infrastructure. Generic rate limiting over hashed keys in
Redis: a fixed-window counter (expires one window after its first count),
checked and rolled back atomically or spent several units at a time, and a
token bucket that lets bursts through while bounding the sustained rate.

## Start here

- `src/domain/ports.rs`: `RateLimitPort` (atomic check/decrement),
  `RateLimitService` (ticket-returning `check_rate_limit` +
  `rollback_ticket`), `TokenBucketPort` (`take` one token) and
  `RateBudgetPort` (`spend` a cost) — read these before the implementation.
  `RateBudgetPort::spend` is for actions that cost more than one each: it adds
  the whole cost or none of it, and is not rolled back.
- `src/outbound/redis.rs`: the Redis-backed adapter for all three;
  `src/outbound/redis/token_bucket.lua` refills and takes in one script on
  Redis time, so processes with different clocks share one bucket. The
  counter and the cost spend open a connection per call on a
  `redis::Client`; the token bucket
  runs on a `redis::aio::ConnectionManager`, one shared connection, because a
  connection per take made a burst of concurrent takes wait hundreds of
  milliseconds each. The manager reconnects only after an I/O error and keeps
  any other failed connection setup (AUTH, SELECT, HELLO) until the process
  restarts; DSS's URL has no password or database, so setup sends none of
  those. Revisit before giving that URL a password or a database.
- `src/domain/models.rs`: `RateLimitKey`/`RateLimitKeyBuilder` — callers
  build the key from whatever data should be rate-limited; the crate never
  interprets it.

## Scope

- Owns: the check/decrement/ticket protocol, cost spends, the token bucket,
  and their Redis implementation.
- Not here: what gets rate-limited or at what threshold — that's each
  caller's `RateLimitConfig` and key construction.

## Boundaries

- Used by: `dictation`, `contacts`, `webhook`, `call`, `notification`,
  `referral`, `gtm_invite`, `search_service` (token bucket),
  `services/document_storage_service`,
  `services/notification_service`, `services/contacts_service`,
  `services/authentication_service`.

## Recipes

- Rate-limit a new action: build a `RateLimitKey` with
  `RateLimitKeyBuilder` → call `check_rate_limit` before the action →
  `rollback_ticket` if the action then fails.
- Allow bursts but bound the rate: build a `RateLimitKey` → `take` from
  `TokenBucketPort` with a `TokenBucketConfig` (capacity, refill interval)
  before the action; there is no rollback, a taken token stays taken.
- Limit something counted in units (recipients, items): the same key and
  config → `RateBudgetPort::spend(key, config, cost)` before the action.

## Checks

- `cargo test -p rate_limit` (`SQLX_OFFLINE` unset), with a Redis at
  `REDIS_URL` (default `redis://127.0.0.1:6379`).
- `cargo test -p rate_limit --features testing` to exercise the
  testing-only constructors in `src/domain/models.rs`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
