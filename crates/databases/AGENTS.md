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

## Scope

- Owns: database/table/column/row/view/saved-query persistence, the typed ops
  batch API, sharing, provisioning, and the `database_entities` app-entity layer.
- Not here: the SQL grammar agents and the console compile → `crates/database_sql`
  (pure parse/resolve/fold engine, also runs in wasm); the agent-facing SQL
  adapter that runs that engine over this crate's ops and Soup →
  `crates/databases_sql`.

## Boundaries

- Depends on: `entity_access` (permission scoping), `properties` (cell values),
  `macro_event_broker`/`macro_event_topics` (change notifications),
  `connection_gateway_client` (liveness), `entity_mutation` (rename/trash/restore).
- Used by: `databases_sql` (agent SQL), `crm` and `forms` (own storage via
  `DatabaseStorage`, no `database_entities` row), `ai_tools`, `complete_graph`,
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

- `databases` (core storage) and `database_entities` (app identity: name,
  owner, trash) are separate tables by design; a host can use one without the
  other (see README "Storage and app entities").
- Column type changes must convert every value or refuse with the misfit count;
  never silently drop data outside an explicit delete.

## Related

- Skill: `database-core` · Rules: `.agents/rules/rust/db.md`,
  `.agents/rules/rust/architecture.md`
