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
- `src/auth.rs`: shared auth-cache helpers (feature `auth`), including the
  single-use mobile login sessions behind sign-in session codes. A code bound
  to a sign-in is one hash under its own prefix (`mbl_login_bound:`), so its
  challenge can't be evicted apart from it and a server that predates binding
  never finds it. A taken code keeps its deadline on Redis's clock, and a
  restore puts it back until then, not for a fresh lifetime, or deletes it
  when it can't set that deadline. Its Lua scripts are files in `src/auth/`,
  loaded with `include_str!`; both takes start with `deadline.lua`.

## Scope

- Owns: rate-limit counters for auth-adjacent flows (login codes, account
  creation, passwordless, verification emails).
- Not here: general-purpose Redis operations — those are `macro_redis`.
  Code that must keep a key out of its errors (keys holding a session code
  or an email) calls `redis` directly: `macro_redis` names the key in its
  error context.

## Boundaries

- Depends on: `macro_redis`, `email_validator` (optional, per rate-limit
  feature).
- Used by: `authentication_service`.

## Recipes

- Add a new rate limit: new `src/<name>_rate_limit.rs` module → feature flag
  in `Cargo.toml` → `pub mod` gated on it in `src/lib.rs` → add to the `all`
  feature if it should ship by default.

## Checks

- `cargo test -p macro_cache_client` (`SQLX_OFFLINE` unset). The `auth` tests
  need Redis: CI's on `127.0.0.1:6379`, or set `REDIS_URL` (no credentials;
  some tests add and remove an ACL user, so it must allow that). To check a new
  script against a cluster, point `REDIS_URL` at a one-node cluster:
  `redis-server --port <p> --cluster-enabled yes`, then
  `redis-cli -p <p> cluster addslotsrange 0 16383`. The session code takes
  read a deadline with PEXPIRETIME on Redis 7.0 and later and rebuild it from
  TIME and PTTL before that; to check the older path, run the tests against a
  Redis 6.2 (`nix build github:NixOS/nixpkgs/nixos-21.11#redis`).

## Gotchas

- Keep each Lua script or `MULTI` to one key. On a Redis cluster a script
  whose keys hash to different slots fails with `CROSSSLOT`. CI's Redis runs
  without cluster mode, so it never shows that.

## Related

- Rules: `.agents/rules/rust/security.md`
