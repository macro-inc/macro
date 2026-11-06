# authentication_service_client

## What it is

Part of shared infrastructure: the typed Rust client other services use to
call `authentication_service`'s internal API (users, Google access tokens,
AI billing hooks, inbox-grant management), one module per endpoint group.

## Start here

- `src/lib.rs`: `AuthServiceClient` (base URL + internal-auth header) and the
  `INTERNAL_AUTH_HEADER_KEY` every endpoint call authenticates with.
- `src/users.rs`, `src/google_access_token.rs`, `src/ai_billing.rs`,
  `src/unlink.rs`, `src/relocate_inbox_grant.rs`, `src/delete_inbox_grant_user.rs`:
  one file per endpoint group, each adding methods to `AuthServiceClient`.
- `src/error.rs`: shared client error type.

## Scope

- Owns: typed request/response methods for calling `authentication_service`'s
  internal API.
- Not here: `authentication_service`'s own HTTP routes or domain logic — this
  crate only calls them.

## Boundaries

- Depends on: `model` (shared types), `reqwest`.
- Used by: `email`, `google_token`, `ai_billing`, and other services that need
  internal user/auth operations from `authentication_service`.

## Recipes

- Add a new endpoint call: add a method in the matching `src/<group>.rs` file
  (or a new file + `pub mod` in `src/lib.rs` for a new group) → match the
  request/response shape against the route in `authentication_service`'s inbound
  router.

## Checks

- `cargo test -p authentication_service_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/config-and-service-urls.md`, `.agents/rules/rust/architecture.md`
