# sync_service_client

## What it is

Part of the Documents (collaborative editing/sync) feature — the HTTP client
for the deployed sync service (`services/sync-service`, a Cloudflare Durable
Object): document CRUD, state, surfaces, and wakeup calls.

## Start here

- `src/lib.rs`: `SyncServiceClient`, built with an internal auth key and base
  URL; trusts the checked-in local CA when the URL is `https://localhost(:port)`
  so local HTTPS stacks work without a system cert.
- One module per endpoint: `initialize.rs`, `get_raw.rs`, `document_state.rs`,
  `copy_document.rs`, `delete.rs`, `exists.rs`, `metadata.rs`, `surface.rs`,
  `wakeup.rs`. Each has a colocated `test.rs` where present.

## Scope

- Owns: the HTTP contract with the sync service.
- Not here: the sync service's own domain/ports → `crates/sync_service`;
  the sync service implementation itself → `services/sync-service`.

## Boundaries

- Depends on: `macro_sync_service_jwt`, `model`, `sync_service_hex`
  (`crates/sync_service`, aliased).
- Used by: `services/document_storage_service`, `services/agent_harness_service`,
  `services/document_upload_finalizer_handler`, `services/agent_harness_service`,
  `crates/documents`, `crates/collab_surface`, `crates/ai_tools`,
  `crates/memory`, `tooling/seed_cli`.

## Recipes

- Add a new endpoint: new `src/<verb>.rs` module → `pub mod` in `src/lib.rs` →
  method on `SyncServiceClient` → matching handler in `services/sync-service`.

## Checks

- `cargo test -p sync_service_client` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/config-and-service-urls.md`
