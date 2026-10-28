# sync_service

## What it is

Part of the Documents (collaborative editing/sync) feature — a hex crate
defining the sync service's domain ports and an axum router shim, used by
`document_storage_service`'s in-process sync integration. Package name is
`sync_service_hex` (not `sync_service`) — depend on it with
`path = "../sync_service", package = "sync_service_hex"`.

## Start here

- `src/domain/models.rs`, `src/domain/ports.rs`: the domain's document-state
  port, implemented by the actual sync-service document store.
- `src/inbound/axum_router.rs` (feature `inbound`): HTTP router shim.

## Scope

- Owns: the port contract for document sync state used by
  `services/document_storage_service`'s in-process sync integration.
- Not here: the deployed Cloudflare Durable Object sync service itself →
  `services/sync-service`; calling it over HTTP → `crates/sync_service_client`.

## Boundaries

- Depends on: `macro_authorization` (feature `inbound`).
- Used by: `services/document_storage_service`, `crates/sync_service_client`.

## Checks

- `cargo test -p sync_service_hex` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
