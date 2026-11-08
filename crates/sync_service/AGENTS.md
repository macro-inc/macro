# sync_service

## What it is

DSS-side bulk wakeup contract and Axum router shim for document sync.
`SyncWakeupService` dispatches wakeups without waiting for sync-service responses. Package name is
`sync_service_hex` (not `sync_service`) — depend on it with
`path = "../sync_service", package = "sync_service_hex"`.

## Start here

- `src/domain/ports.rs`: `SyncWakeupService::bulk_wakeup`, implemented by the DSS-side wakeup adapter.
- `src/inbound/axum_router.rs` (feature `inbound`): HTTP router shim.

## Scope

- Owns: the DSS-side bulk-wakeup port used by `services/document_storage_service`.
- Room state, protocol and sync policy live in `sync_server_core` and `sync_protocol`.
- Not here: the deployed Cloudflare Durable Object sync service itself →
  `services/sync-service`; calling it over HTTP → `crates/sync_service_client`.

## Boundaries

- Depends on: `macro_authorization` (feature `inbound`).
- Used by: `services/document_storage_service`, `crates/sync_service_client`.

## Checks

- `cargo test -p sync_service_hex` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
