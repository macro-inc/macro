# email_service_client

## What it is

Part of the Email feature: a Rust HTTP client for `email_service` —
message/thread lookups by id, thread owner lookup, and an external
(JWT-authenticated) preview endpoint.

## Start here

- `src/lib.rs`: `EmailServiceClient` (internal auth header, one `reqwest`
  client).
- `src/external.rs`: `EmailServiceClientExternal`, the JWT-authenticated
  counterpart used for external/preview calls.
- `src/get_message_by_id.rs`, `src/get_messages_by_thread_id.rs`,
  `src/get_message_senders.rs`, `src/get_thread_owner.rs`: one module per
  endpoint.

## Scope

- Owns: typed request/response wrapping for `email_service`'s HTTP API.
- Not here: `email_service`'s own domain logic → `crates/email`.

## Boundaries

- Depends on: `email` (features `axum`, `inbound`), `model`, `models_email`.
- Used by: `crates/memory`, `crates/ai_tools`, `services/document_cognition_service`,
  `services/mcp_service`.

## Recipes

- Add an endpoint: new module with `impl EmailServiceClient` (internal auth)
  or `impl EmailServiceClientExternal` (JWT) → wire response types from
  `email`/`models_email`.

## Checks

- `cargo test -p email_service_client` (`SQLX_OFFLINE` unset; no database
  needed).

## Gotchas

- Two client types, not two modes of one struct: `EmailServiceClient` is for
  internal service-to-service calls, `EmailServiceClientExternal` is for
  calls authenticated with a caller's JWT — pick the one matching the caller.

## Related

- Rules: `.agents/rules/rust/architecture.md`
