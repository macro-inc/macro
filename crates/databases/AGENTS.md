# databases

## What it is

The core of the Databases feature (also underlies CRM and Forms storage):
tables of typed rows whose cells are entity properties, behind a hexagonal
service with Axum, agent-tool and Postgres adapters.

## Start here

- `README.md`: the op/result contract (`POST /databases/{id}/ops`), the
  `databases`/`database_entities` storage-vs-app-entity split, and a review map
  of every module.
- `src/domain/service.rs` + `src/domain/ports.rs`: orchestration and the ports
  adapters implement.
- `src/domain/models.rs`: `Database`, `DatabaseStorage`, typed ops/results.
- `set_appearance` updates `database_entities` presentation under Edit access, preserving content dates and committing history-only activity in the same transaction.

## Scope

- Owns: database/table/column/row/view/saved-query persistence, the typed ops
  batch API, sharing, provisioning, duplication, and the `database_entities`
  app-entity layer.
- Not here: the SQL grammar agents and the console compile → `crates/database_sql`
  (pure parse/resolve/fold engine, also runs in wasm); the agent-facing SQL
  adapter that runs that engine over this crate's ops and Soup →
  `crates/databases_sql`.

## Boundaries

- Depends on: `entity_access` (permission scoping), `entity_access_db_utils` and
  `share_permission_db_utils` (channel grants and the team share), `properties` (cell values),
  `macro_event_broker`/`macro_event_topics` (change notifications),
  `connection_gateway_client` (liveness), `entity_mutation`
  (rename/move/duplicate/trash/restore).
- Used by: `databases_sql` (agent SQL), `crm` and `forms` (own storage via
  `DatabaseStorage`, no `database_entities` row), `database_webhooks` (writes
  as its creator, re-checked through the `CreatorAccess` port and its
  `outbound::entity_access_creators` adapter), `ai_tools`, `complete_graph`,
  `graphql_crm`. The document storage service mounts `src/inbound/axum_router.rs`.

## Recipes

- Add a new op kind: `models_databases` (op/result shape) → `src/domain/service/ops/`
  (per README's review map) → `src/outbound/pg_databases_repo.rs` → add a row to
  the README's op/result tables.
- Add a Postgres-backed read/write path for a new host (like CRM/forms): use
  `DatabaseStorage::create_storage`/`apply_storage_writes` via the `postgres`
  feature; do not add a `database_entities` row unless the host needs Soup
  discovery, sharing, and trash semantics.

## Checks

- `cargo test -p databases --features postgres,inbound,ai_tools,gateway,entity_mutation`
  (`SQLX_OFFLINE` unset; needs a migrated local MacroDB).

## Gotchas

- `POST /databases` and `POST /databases/{id}/duplicate` attribute the
  creation to the SDK token's `agent_id` (code mode, `agent_attribution`), like
  the native tool, so channel delivery shares a database an agent makes; access
  checks still run as the plain user (`viewer_of`).
- Hosts authorize the database through their own entity before calling
  `storage_view_positions`; the operation also checks database, table and view
  membership.
- A duplicate rewrites IDs while walking each column config, view and card
  position as JSON. Cells are rewritten only in their option and row references,
  never in text. Copy saved appearance into the duplicate's app entity in the
  same transaction as storage and grants; keep the copy outside any folder.
- `databases` (core storage) and `database_entities` (app identity: name,
  owner, trash) are separate tables by design; a host can use one without the
  other (see README "Storage and app entities").
- Column type changes must convert every value or refuse with the misfit count;
  never silently drop data outside an explicit delete.
- Filing in a folder (`database_entities.project_id`, `MoveEntity`): owner
  only; the repository swaps the folder-inherited `entity_access` rows in the
  same transaction (`entity_access_db_utils::project_grants`), after
  `refuse_filing` checks the new folder against the rows it holds. Trashing or
  purging the folder returns the database to the root without the folder's
  grants; trashing goes through `PgDatabaseFolders`, which the projects
  domain reaches through its `FiledItemsUnfiler` port.
- Sharing (`src/domain/sharing.rs`): channel grants and a team share; no share
  link. The team share's state lives in a `SharePermission` row that
  `database_entities.share_permission_id` points at, made the first time the
  owner sets it, and its grant is a team-source `entity_access` row that rows,
  listing and Soup read like any other. Only the actual owner may change it.

## Related

- Skill: `database-core` · Rules: `.agents/rules/rust/db.md`,
  `.agents/rules/rust/architecture.md`
