# rate_limit

## What it is

Part of shared infrastructure. Generic rate limiting: a hashed-key
sliding-window counter, checked and rolled back atomically via Redis, and a
concurrency limit (at most N live leases per key) for long-lived holders such
as open event streams.

## Start here

- `src/domain/ports.rs`: `RateLimitPort` (atomic check/decrement) and
  `RateLimitService` (ticket-returning `check_rate_limit` +
  `rollback_ticket`) — read these before the implementation.
- `src/outbound/redis.rs`: the Redis-backed adapter.
- `src/outbound/redis_concurrency.rs`: `ConcurrencyLimitPort` over a sorted
  set of holders scored by lease expiry (Redis server clock).
- `src/domain/models.rs`: `RateLimitKey`/`RateLimitKeyBuilder` — callers
  build the key from whatever data should be rate-limited; the crate never
  interprets it.

## Scope

- Owns: the check/decrement/ticket protocol and its Redis implementation.
- Not here: what gets rate-limited or at what threshold — that's each
  caller's `RateLimitConfig` and key construction.

## Boundaries

- Used by: `dictation`, `contacts`, `webhook`, `call`, `notification`,
  `referral`, `gtm_invite`, `services/document_storage_service`,
  `services/notification_service`, `services/contacts_service`,
  `services/authentication_service`.

## Recipes

- Rate-limit a new action: build a `RateLimitKey` with
  `RateLimitKeyBuilder` → call `check_rate_limit` before the action →
  `rollback_ticket` if the action then fails.
- Cap concurrent holders: `ConcurrencyLimitPort::acquire` at start and on
  every renewal (well inside the lease) → `release` at the end. A holder that
  dies stops counting when its lease lapses.

## Checks

- `cargo test -p rate_limit` (`SQLX_OFFLINE` unset).
- `cargo test -p rate_limit --features testing` to exercise the
  testing-only constructors in `src/domain/models.rs`.

## Related

- Rules: `.agents/rules/rust/architecture.md`
