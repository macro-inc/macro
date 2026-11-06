# macro_cache_client

## What it is

Belongs to shared infrastructure (authentication): Redis-backed rate
limiters for auth-adjacent flows, one module per limited action, each gated
behind its own Cargo feature.

## Start here

- `src/lib.rs`: `MacroCache::new` — thin wrapper around `redis::Client`;
  modules are enabled per feature (`auth_rate_limit`, `login_code_rate_limit`,
  `notification_rate_limit`, `mobile_welcome_email_rate_limit`,
  `verify_email_rate_limit`).
- `src/passwordless_rate_limit.rs`, `src/create_user_rate_limit.rs`: the
  `auth_rate_limit` feature's two limiters.
- `src/auth.rs`: shared auth-cache helpers (feature `auth`).

## Scope

- Owns: rate-limit counters for auth-adjacent flows (login codes, account
  creation, passwordless, verification emails).
- Not here: general-purpose Redis operations — those are `macro_redis`
  (which this crate does not depend on; it rolls its own Redis calls per
  limiter module).

## Boundaries

- Depends on: `macro_redis`, `email_validator` (optional, per rate-limit
  feature).
- Used by: `authentication_service`.

## Recipes

- Add a new rate limit: new `src/<name>_rate_limit.rs` module → feature flag
  in `Cargo.toml` → `pub mod` gated on it in `src/lib.rs` → add to the `all`
  feature if it should ship by default.

## Checks

- `cargo test -p macro_cache_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/security.md`
