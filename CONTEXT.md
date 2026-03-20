# Email Projects Feature — Context for Continuation

## What was built
Full project support for email threads — the ability to assign email threads to projects/folders, filter them by project, and display them in project views. This mirrors existing functionality for Documents and Chats.

## PR
https://github.com/macro-inc/macro/pull/2065 (branch: `evan/email-projects`) — all CI passing.

## Backend Changes (Rust)

**DB Migration** (`macro_db_client/migrations/20260319232323_add_project_id_to_email_threads.sql`):
- Added `project_id text` column to `email_threads` with FK to `Project(id)`, `ON DELETE SET NULL`, and an index.

**PATCH endpoint** — hex pattern in the `email` crate:
- `PATCH /email/threads/{thread_id}/project` with body `{ "projectId": "..." }` (or null to remove)
- Uses `ThreadAccessLevelExtractor<EditAccessLevel>` for thread access + `ProjectBodyAccessLevelExtractor<EditAccessLevel>` for target project access
- Service method requires owner-level access on the thread (checked via `EntityAccessReceipt`)
- Project ID is extracted from the project receipt, not passed as a separate parameter
- Files: `thread_project_router.rs` (hex router), `ports.rs` (trait methods on `EmailRepo` + `EmailService`), `service/mod.rs` (impl), `outbound/email_pg_repo/thread.rs` (SQL queries)

**`project_id` wired through soup response chain:**
- `ThreadPreviewCursorDbRow` → `EmailThreadPreview` → `SoupEmailThreadPreview` → API response
- All 8 static preview view queries updated to SELECT `t.project_id`
- Dynamic query updated too
- `ApiThread` (GET thread response) also returns `project_id`

**Email filters — `project_ids` for soup queries:**
- Added `project_ids: Vec<String>` to `EmailFilters` in `item_filters`
- Added `ProjectId(String)` variant to `EmailLiteral` AST
- Dynamic query builder: `ProjectId` generates `t.project_id = <bound>` at thread level, `TRUE` at message level
- 7 unit tests + 4 integration tests

**Entity access queries** (`entity_access/src/outbound/pg_access_repo/queries/`):
- `thread_access.rs` and `thread_users.rs` updated to resolve project hierarchy from `email_threads.project_id` directly instead of `EmailThreadPermission.projectId`

**Important: sqlx offline caches** — after any SQL changes, run `just prepare_db` in the crate that owns the queries (e.g. `email/`, `entity_access/`, `macro_db_client/`). The email crate and entity_access crate each have their own `.sqlx/` directory.

## Frontend Changes (TypeScript/SolidJS)

**Types:**
- `EmailEntity` in `entity/src/types/entity.ts` — added `projectId?: string`
- Generated types regenerated via `just gen-api email-service cloud-storage search-service` from `js/app/`

**Project view shows emails:**
- `block-project/component/Block.tsx` — changed `email_filters` from `{ recipients: [NIL_UUID] }` to `{ project_ids: [props.projectId] }`; added `'email'` to `PROJECT_ENTITY_TYPES`
- `queries/soup/transform-utils.ts` — added `projectId: item.data.projectId ?? undefined` to emailThread mapping

**Move to folder:**
- `service-email/client.ts` — added `updateThreadProject` method
- `core/component/FileList/itemOperations.ts` — added `'email'` case to `moveToFolder` (calls `emailClient.updateThreadProject`) and `getItemAccessLevel` (calls `emailClient.getThread` with limit 1, returns `access_level`)
- `next-soup/actions/make-move-to-project-action.ts` — removed email exclusion from `canExecute`
- `macro-entity/src/queries/dss.ts` — added email support in bulk move mutation with `email` → `emailThread` tag mapping for optimistic updates

**Folder filter UI:**
- `filter-controls.tsx` — `FolderFilterTarget` includes `'email'`, reads/writes `email_filters.project_ids`

## Known Limitations
- **Command palette / `m` hotkey** doesn't work for email blocks because email threads aren't in the user history system, so they never appear in the quick access store. The right-click menu and bulk move modal work fine. See memory file `project_quick_access_store.md` for details.
- **Generated types** — after changing Rust utoipa annotations, run `just gen-api <service-name>` from `js/app/`. Valid service names: `email-service`, `cloud-storage`, `search-service`, etc. Don't manually edit files in `service-clients/*/generated/`.

## Key Patterns to Follow
- **Hex routers** in the `email` crate: generic over state type, use trait bounds, wired into `email_service` via merge. See `thread_labels_router.rs` or `thread_project_router.rs` as examples.
- **`ProjectBodyAccessLevelExtractor`** checks project access from the request body's `projectId` field (camelCase). It's a `FromRequest` extractor (consumes body), must be the last parameter.
- **`EntityAccessReceipt`** should be passed into service methods to prove the caller was authorized at the transport layer.
- **Dynamic email queries** use an AST (`EmailLiteral`) that splits into thread-level and message-level filters. Thread-level literals (like `ProjectId`, `ThreadId`) generate SQL against `email_threads t`, message-level literals generate SQL against `email_messages m`.
