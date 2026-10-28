# projects

## What it is

Part of the Projects feature (folder organization for documents and other
entities). Owns the project entity: hierarchy, sharing/team-share policy,
soft delete/restore/purge, and bulk upload into a project tree.

## Start here

- `src/domain/ports.rs`: `ProjectRepo`, `ProjectService`, and the upload/search
  ports — start here to see the contract before the implementation.
- `src/domain/service.rs`: the concrete service (access checks, team-share
  authorization, soft-delete/restore/purge, bulk upload orchestration).
- `src/domain/events.rs`: the `ProjectMacroEvent` variants published to the
  event broker.
- `src/outbound/pg_project_repo.rs`, `src/outbound/dynamo_bulk_upload.rs`,
  `src/outbound/s3_upload_urls.rs`, `src/outbound/sqs_search_indexer.rs`:
  the adapters behind those ports.

## Scope

- Owns: project CRUD, hierarchy, team-share authorization for projects, and
  bulk-upload-into-project orchestration.
- Not here: generic item access/sharing primitives → `entity_access`,
  `entity_access_management`; property values on a project → `properties`.

## Boundaries

- Depends on: `entity_access`, `entity_access_management`,
  `macro_event_broker`, `model_owner`, `models_permissions`.
- Used by: `ai_tools` (project tools), `soup_realtime`,
  `services/deleted_item_poller`, `services/search_processing_service`.

## Recipes

- Add a mutation route: `src/domain/ports.rs` (`ProjectService` method) →
  `src/domain/service.rs` → `src/inbound/axum_router.rs`.
- Add an AI tool: `src/inbound/toolset.rs` → the `ai_tools` feature gate in
  `Cargo.toml`.

## Tool contracts

- AI project tools omit legacy chat targets and results; agent-session lifecycle and sharing belong to `agent_session`.

## Checks

- `cargo test -p projects` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
