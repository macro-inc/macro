# Backend implementation sketch

The full shape of the Rust backend for databases: one new domain crate wired into
document_storage_service, hexagonal throughout. `crates/reminders` is the structural
template (smallest complete entity crate); `crates/properties` is the domain-logic
template. Authorization crosses the boundary only as `EntityAccessReceipt<T>`; all policy
lives in domain services.

## Crate layout

```
crates/databases/
  Cargo.toml                      # features: ports, service, inbound, outbound, axum, ai_tools
  src/lib.rs                      # #![deny(missing_docs)]
  src/domain/
    models.rs                     # Database, Table, Column, Row, RowLink, TableVersion,
                                  #   commands (CreateTable, UpdateCell, LinkRows, …)
                                  #   QueryRequest, QueryResult, ColumnProvenance, TableDeps
    models/test.rs
    error.rs                      # DatabaseError (rootcause), QueryError (incl. SqlError{msg} passthrough)
    ports.rs                      # the port traits (below)
    service.rs                    # DatabaseService + QueryService traits (what inbound calls)
    service_impl.rs               # policy + orchestration
    service_impl/
      rows.rs                     # cell writes: validate via models_properties, version bump
      columns.rs                  # column create = property_definition create (Database owner)
      links.rs                    # link/unlink, reverse-column semantics
      query.rs                    # the run-query use case (see "Query pipeline")
      test.rs                     # allow/deny + business-rule tests with fake ports
    events.rs                     # DatabaseEvent { TableChanged { table_id, version }, … }
    activity.rs                   # activity records (crates/activity integration)
  src/outbound/
    pg_database_repo.rs           # sqlx: databases / database_tables / database_columns
    pg_row_repo.rs                # sqlx: database_rows (JSONB cells), database_row_links
    pg_definition_repo.rs         # thin wrapper over crates/properties definition/option queries
    rusqlite_executor.rs          # SqlExecutor port impl: prepare, authorizer, materialize-in, run
    magic/
      mod.rs                      # registry: name -> Box<dyn MagicTableSource>
      people.rs                   # ContactsDB-backed
      documents.rs                # entity_access-filtered MacroDB query
      tasks.rs                    # documents with DocumentSubType::Task + property pivot
      companies.rs / calls.rs / email_threads.rs
    redis_event_publisher.rs      # TableEventPublisher port impl (connection_gateway fan-out)
    sqs_search_indexer.rs         # optional v1 (Postgres-only search is fine initially)
  src/inbound/
    axum_router.rs                # nests the sub-routers, owns RouterState<S: DatabaseService, …>
    axum_router/
      databases.rs                # CRUD on the entity
      tables.rs / columns.rs / rows.rs / links.rs
      query.rs                    # POST /databases/query
      test.rs
    toolset.rs                    # AI tools: create_database, add_rows, update_cells,
    toolset/                      #   query_database, describe_database_schema
      …one file per tool
```

Plus a receipt extractor: `crates/entity_access/src/inbound/axum_extractors/database.rs`
(copy the `reminder.rs` shape) minting `EntityAccessReceipt<View|Edit|OwnerAccessLevel>`
for `EntityType::Database` from a path param.

## Migrations (`crates/macro_db_client`, via `sqlx migrate add`)

1. `add_databases` — `databases`, `database_tables` (with `version BIGINT`),
   `database_columns` (placement over `property_definitions`), `database_rows`
   (`cells JSONB`), `database_row_links` + indexes (see storage.md DDL).
2. `add_database_property_owner` — extend `property_definitions` ownership with a
   `database_id` dimension (mirrors the team-scoping migration) + uniqueness per scope.
3. `add_database_entity_type` — add `DATABASE` to the entity-type enums that are Postgres
   enums (`property_entity_type` etc. as needed).

After each: `nix develop --command just prepare_db` from repo root.

## Domain ports (`ports.rs`)

```rust
/// Rows/tables/columns persistence. Implemented by pg_* repos.
#[async_trait]
pub trait DatabaseRepo {
    async fn create_database(&self, cmd: CreateDatabase) -> Result<Database, DatabaseError>;
    async fn get_database(&self, id: &DatabaseId) -> Result<DatabaseWithTables, DatabaseError>;
    async fn create_table(&self, cmd: CreateTable) -> Result<Table, DatabaseError>;
    async fn fetch_rows(&self, table_id: &TableId) -> Result<Vec<Row>, DatabaseError>;
    async fn update_cells(&self, cmd: UpdateCells) -> Result<TableVersion, DatabaseError>;
    async fn insert_rows(&self, cmd: InsertRows) -> Result<Vec<Row>, DatabaseError>;
    async fn link_rows(&self, cmd: LinkRows) -> Result<TableVersion, DatabaseError>;
    // … delete/reorder/etc. Every mutation returns the bumped TableVersion.
}

/// Column definitions live in the properties system; this port wraps it.
#[async_trait]
pub trait ColumnDefinitionStore {
    async fn create_definition(&self, scope: DatabaseScope, def: NewDefinition) -> …;
    async fn definitions_for_tables(&self, ids: &[TableId]) -> …; // incl. options
    async fn promote_to_owner(&self, def_id: Uuid, to: PropertyOwner) -> …;
}

/// One implementor per magic table. Registry lives in outbound, consumed via this trait.
#[async_trait]
pub trait MagicTableSource: Send + Sync {
    fn schema(&self) -> TableSchema;                      // name + typed columns
    async fn materialize(&self, viewer: &Viewer, columns: &[ColumnName])
        -> Result<MaterializedTable, QueryError>;         // permission-scoped
}

/// The embedded SQLite sandbox. Implemented by rusqlite_executor.
pub trait SqlExecutor: Send + Sync {
    /// Prepare against a schema-only catalog; returns referenced tables+columns
    /// (authorizer callback) or the SQLite error verbatim.
    fn analyze(&self, catalog: &Catalog, sql: &str) -> Result<TableDeps, QueryError>;
    /// Load materialized tables, execute read-only with timeout/row caps,
    /// return typed rows + per-column provenance.
    fn execute(&self, tables: Vec<MaterializedTable>, sql: &str, limits: Limits)
        -> Result<QueryResult, QueryError>;
}

/// Liveness fan-out. Implemented by redis_event_publisher.
#[async_trait]
pub trait TableEventPublisher {
    async fn table_changed(&self, table_id: &TableId, version: TableVersion) -> Result<(), DatabaseError>;
}
```

Plus reuse of existing ports: activity recorder, clock/id-gen if the house style wants
them injectable.

## The query pipeline (`service_impl/query.rs`)

The one genuinely novel use case. Domain service orchestrates; adapters do mechanics:

```rust
async fn run_query(&self, viewer: Viewer, req: QueryRequest) -> Result<QueryResult, QueryError> {
    // 1. catalog: every table this viewer can see (their db tables via entity_access,
    //    junction views derived from link columns, all magic table schemas)
    let catalog = self.build_catalog(&viewer).await?;
    // 2. sugar rewrite (HAS) — pure function in domain
    let sql = desugar(&req.sql);
    // 3. deps via prepare/authorizer (SqlExecutor port)
    let deps = self.executor.analyze(&catalog, &sql)?;
    // 4. materialize only referenced tables, permission-scoped:
    //    user tables -> DatabaseRepo::fetch_rows + option/display resolution
    //    junctions   -> DatabaseRepo link fetch
    //    magic       -> MagicTableSource::materialize(viewer, referenced_columns)
    let tables = self.materialize(&viewer, &deps).await?;
    // 5. execute sandboxed; result carries per-column provenance
    //    { origin: Table.Column, entity_type: Option<EntityType>, writable: bool }
    //    and per-row base row ids when the plan is 1:1 (write-through support)
    let result = self.executor.execute(tables, &sql, Limits::default())?;
    // 6. attach deps+versions for client-side liveness subscription
    Ok(result.with_deps(deps))
}
```

Authorization note: `POST /databases/query` takes no single entity receipt — the query may
span tables. The *catalog itself is the authorization*: it is built from the viewer's
`entity_access` grants, so an unreadable table never exists in the prepare catalog (query
against it fails as "no such table") and unreadable rows/entities are never materialized.
That policy lives in `build_catalog`/`materialize` in the domain service, tested with fake
ports.

rusqlite specifics (outbound): `Connection::open_in_memory()`, `set_authorizer` for both
dep-collection during `analyze` and SELECT-only enforcement during `execute`,
`progress_handler`/`interrupt` for the ~100ms budget, deterministic bulk insert in one
transaction. Add `rusqlite` (bundled feature) to the workspace — first embedded-SQLite dep
in the repo; `bundled` avoids any system libsqlite dependency in nix.

## Inbound surface

Routes (nested in DSS at `/databases`):

| route | receipt | service call |
|---|---|---|
| `POST /databases` | authenticated identity | `create_database` |
| `GET /databases/:id` | `View` | `get_database` (tables+columns+defs) |
| `GET /databases/:id/tables/:tid/rows` | `View` | `fetch_rows` (paginated) |
| `POST …/tables` `PATCH …/tables/:tid` | `Edit` | table CRUD |
| `POST …/columns` `PATCH/DELETE …/columns/:cid` | `Edit` | column ops (definition create/bind/promote) |
| `POST …/rows` `PATCH …/rows/:rid/cells` `DELETE …/rows/:rid` | `Edit` | row ops |
| `POST/DELETE …/links` | `Edit` | link ops |
| `POST /databases/query` | identity only (catalog is the authz) | `run_query` |

Handlers: extract receipt via the new database extractor, parse DTO, call service, map
errors. No policy, no persistence, per the hexagonal guard. Rename/trash/share/move come
free from implementing the `entity_mutation` capability traits
(`RenameEntity`, `TrashEntity`, …) registered in
`services/document_storage_service/src/service/entity_mutation.rs`.

AI tools (`inbound/toolset/`, via the create-ai-tool skill): `describe_database_schema`,
`query_database` (returns typed rows for the model), `add_rows`, `update_cells`,
`create_database`. These are thin wrappers over the same domain services with the actor's
receipt.

## Entity plumbing (the ~26-file checklist)

- `EntityType::Database` in `crates/model-entity` (+ `is_valid_entity_access_entity` → true)
- `GraphqlEntityType`, `SoupItem::Database` + soup repo/loaders/objects, soup `ItemType`
- `models_properties::EntityType` only if entities-in-cells need to *target* databases
- Search: start Postgres-only (the `CrmCompanies` precedent); OpenSearch later
- `crates/entity_access` extractor + delete cascade in `macro_db_client/item_access/delete.rs`
- Webhook/activity ingestion touch points (trace `EntityType::Reminder` for the full list)

## Composition root

`services/document_storage_service/src/api.rs`: construct
`DatabaseServiceImpl::new(pg_database_repo, pg_row_repo, definition_store, magic_registry,
rusqlite_executor, redis_publisher, activity)` and nest
`databases::inbound::axum_router(state)`. Magic registry construction is the one place
that knows about ContactsDB clients etc.

## Cross-cutting conventions

- Errors: `rootcause`; `#[tracing::instrument(err)]` on Result-returning service methods.
- sqlx compile-time macros everywhere; `just prepare_db` after query changes; tests in
  `foo/test.rs` submodules; fixtures for pg repo tests; run
  `cargo test -p databases` (needs `bash .cursor/infra.sh` once for pg/redis).
- Env vars (limits, feature flag) via `macro_env_var` macros.
- OpenAPI via utoipa on inbound DTOs → SDK wrapping per add-sdk-endpoint
  (`packages/sdk/src/entities/databases/`, `just coverage` enforces).

## Phasing (PR-sized)

1. **Migration + entity skeleton**: tables, `EntityType::Database`, enum plumbing,
   entity_access extractor, entity_mutation capabilities, empty crate compiling.
2. **CRUD spine**: domain models/ports/service, pg repos, routers for
   database/table/column/row/link ops, `PropertyOwner::Database` + definition store.
   App can create databases and edit cells (grid works end-to-end).
3. **Query engine**: rusqlite executor + catalog/materializer for user tables and
   junctions, `POST /databases/query`, `HAS` desugar, provenance. Chips work.
4. **Magic tables**: `people` first, then `documents`/`tasks`; property-pivot
   materializer shared.
5. **Liveness**: version events → Redis → connection_gateway; client invalidation.
6. **AI tools + SDK**: toolset, openapi, SDK wrappers.

Steps 3–6 are independent enough to parallelize after 2.

## Open implementation questions

- Does `run_query` execution belong on a `spawn_blocking` pool (rusqlite is sync/CPU) —
  yes, decide pool sizing/limits.
- Pagination + max row counts for `fetch_rows` and materialization caps (env-var'd).
- Whether `database_rows.position` uses the existing fractional-index helper (find what
  soup/tasks ordering uses) or we vendor one.
- Cell-write batching shape (`PATCH …/cells` takes a map of column→SetPropertyValue —
  one version bump per request).
