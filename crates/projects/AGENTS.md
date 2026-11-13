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
  Soft delete trashes a folder's documents and chats; its databases and forms
  return to the root through the `FiledItemsUnfiler` port, which DSS
  implements over the databases and forms repositories.
- `src/domain/events.rs`: the `ProjectMacroEvent` variants published to the
  event broker.
- `src/domain/duplicate.rs`: folder duplication (`ProjectDuplicator`, the
  `DuplicateEntity` impl). It recreates subfolders here and copies documents
  and chats through the `ProjectContentCopier` port, which DSS implements
  over the documents and chat capabilities.
- `src/outbound/pg_project_repo.rs`, `src/outbound/dynamo_bulk_upload.rs`,
  `src/outbound/s3_upload_urls.rs`, `src/outbound/sqs_search_indexer.rs`:
  the adapters behind those ports.

## Scope

- Owns: project CRUD, hierarchy, team-share authorization for projects,
  folder duplication, and bulk-upload-into-project orchestration.
- Not here: generic item access/sharing primitives → `entity_access`,
  `entity_access_management`; property values on a project → `properties`.

## Boundaries

- Depends on: `entity_access`, `entity_access_management`, `entity_mutation`,
  `macro_event_broker`, `model_owner`, `models_permissions`.
- Used by: `ai_tools` (project tools), `soup_realtime`,
  `services/deleted_item_poller`, `services/search_processing_service`.

## Recipes

- Add a mutation route: `src/domain/ports.rs` (`ProjectService` method) →
  `src/domain/service.rs` → `src/inbound/axum_router.rs`.
- Add an AI tool: `src/inbound/toolset.rs` → the `ai_tools` feature gate in
  `Cargo.toml`.
- Copy a folder tree in from elsewhere (an import): create each folder with
  `ProjectService::create_project_dated_by_contents`. It starts never edited
  and leaves its parent alone; documents created in it with their own dates
  date it and the folders above it.

## Tool contracts

- AI project tools omit legacy chat targets and results; agent-session lifecycle and sharing belong to `agent_session`.

## Gotchas

- Folder duplication copies at most `MAX_PROJECT_DUPLICATE_ENTRIES` subfolders,
  documents, and chats, and discards the whole copy if any part fails.
  Email threads are filed by a link on the thread, not owned by the folder,
  so they stay with the source.
- The bulk-upload extractor registers a whole folder in one request through
  `internal_upload_router`, which DSS mounts only on its internal router with
  a 32 MiB body limit; the user-facing `/projects/upload` keeps axum's 2 MiB
  default. `GET /projects/upload_extract/{request_id}` reports the caller's own
  request status and the extractor's stored/failed counts.

## Checks

- `cargo test -p projects` (`SQLX_OFFLINE` unset; requires local MacroDB).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/security.md`
