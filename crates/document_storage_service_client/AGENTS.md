# document_storage_service_client

## What it is

Shared infrastructure for the Documents feature (and the other entities DSS
hosts): a Rust HTTP client for `document_storage_service` (DSS) covering
documents, projects, threads, notifications, and uploads.

## Start here

- `src/lib.rs`: `DocumentStorageServiceClient`, built with two `reqwest`
  clients (see Gotchas).
- `src/error.rs`: `DssClientError`, the shared error type most methods return.
- `src/document.rs`, `src/project.rs`, `src/thread.rs`, `src/notification.rs`,
  `src/upload.rs`, `src/delete.rs`: one module per DSS resource, each adding
  methods via `impl DocumentStorageServiceClient`.

## Scope

- Owns: typed request/response wrapping for DSS's HTTP API.
- Not here: DSS's own domain logic → `services/document_storage_service`;
  the request/response types themselves → `crates/model`.

## Boundaries

- Depends on: `model`, `model_owner`, `models_bulk_upload`,
  `models_permissions`, `shared_entity_registry`.
- Used by: `crates/agent_trigger` and most services that call DSS directly
  (`document_cognition_service`, `authentication_service`,
  `agent_trigger_service`, `search_upload_handler`,
  `upload_extractor_lambda_handler`, `agent_harness_service`,
  `email_service`).

## Recipes

- Add an endpoint: add a method in the matching resource module (or a new
  one) using `self.client` (internal auth) or `self.external_request` (JWT) →
  add request/response types to `crates/model` if new → map the response to
  `DssClientError` on failure.

## Checks

- `cargo test -p document_storage_service_client` (`SQLX_OFFLINE` unset; no
  database needed).

## Gotchas

- Two `reqwest::Client`s: `client` carries the internal auth header for
  service-to-service calls; `external_client` (via `external_request`) sends
  a caller's JWT instead — don't mix them up.

## Related

- Rules: `.agents/rules/rust/architecture.md`
