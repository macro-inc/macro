# macro_middleware

## What it is

Belongs to shared infrastructure: a small grab bag of Axum middleware shared
by several services, each piece gated behind its own Cargo feature.

## Start here

- `src/lib.rs`: `connection_drop_prevention_handler` — wraps
  POST/PUT/PATCH/DELETE handlers in a spawned task so a dropped client
  connection doesn't cancel an in-flight mutation.
- `src/cloud_storage/mod.rs` (feature `cloud_storage`): middleware that needs
  `macro_db_client`/`entity_access_db_utils`/`model_user`.
- `src/tracking/mod.rs` (feature `tracking`): request tracking via
  `ip_extractor`.
- `src/error_handler.rs` (feature `cloud_storage`): shared error-response
  mapping.

## Scope

- Owns: cross-cutting Axum middleware too small to justify their own crate.
- Not here: anything specific enough to one service — keep that in the
  service.

## Boundaries

- Depends on (feature-gated): `macro_db_client`, `entity_access_db_utils`,
  `ip_extractor`, `macro_user_id`, `model_user`.
- Used by: `document_storage_service`, `notification_service`,
  `document_cognition_service`, `authentication_service`,
  `image_proxy_service`, `search_processing_service`, `convert_service`,
  `email_service`.

## Checks

- `cargo test -p macro_middleware` (`SQLX_OFFLINE` unset).

## Gotchas

- `connection_drop_prevention_handler` only wraps mutating methods
  (POST/PUT/PATCH/DELETE); GET/HEAD/etc. pass through unwrapped by design.
- `CS-23`/`CS-28`: this is exactly the kind of catch-all crate that must
  shrink, not grow — a new piece of middleware specific to one domain
  belongs in that domain's crate, not here.

## Related

- Rules: `.agents/rules/rust/architecture.md`
