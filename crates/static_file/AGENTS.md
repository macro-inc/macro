# static_file

## What it is

Shared infrastructure for attachments and uploads — a hex crate for
resolving static file (SFS) references into URLs or metadata without callers
depending on `attachment` directly.

## Start here

- `src/domain/ports.rs`: the `StaticFileResolver` port callers depend on.
- `src/inbound/attachment.rs` (feature `attachment`): adapts `attachment`
  entities onto the port.
- `src/outbound/sfs_client.rs` (feature `outbound`): resolves via
  `static_file_service_client` against the real static file service.

## Scope

- Owns: the port abstraction between "something references a static file" and
  "static file service resolves/serves it."
- Not here: the static file service's HTTP client itself →
  `crates/static_file_service_client`; attachment storage/lifecycle →
  `crates/attachment`.

## Boundaries

- Depends on: `macro_user_id`, `non_empty`; optional `attachment`,
  `model-entity` (feature `attachment`), `reqwest` (feature `outbound`).
- Used by: `crates/ai_tools`, `crates/agent_trigger`, `services/document_cognition_service`,
  `services/agent_trigger_service`, `services/agent_harness_service`.

## Recipes

- Resolve a new kind of static file reference: `src/domain/ports.rs` (port
  method) → `src/inbound/attachment.rs` or a new inbound adapter → composition
  root wiring the outbound adapter.

## Checks

- `cargo test -p static_file` (`SQLX_OFFLINE` unset).

## Related

- Rules: `.agents/rules/rust/architecture.md`
