//! Ports (trait contracts) for the databases domain.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};

use crate::domain::models::{
    AccessGrant, AddColumnOptions, ApplyOutcome, Catalog, Column, ColumnBinding, ColumnDetail,
    ColumnId, CreateColumn, CreateDatabase, CreateTable, Database, DatabaseDetail, DatabaseError,
    DatabaseId, ExecOutcome, ExecRequest, ListedDatabase, MaterializedTable, PropertyDefinitionId,
    QueryError, QueryResult, RawRowChange, Row, RowChange, RowId, SqliteSnapshot, Table, TableDeps,
    TableId, TableVersion, Viewer,
};

/// Outbound persistence port for databases, tables, column placements, rows,
/// and link edges. Implemented by the Postgres repository.
///
/// The repo stores facts; every policy decision (who may do what, what a
/// changeset is allowed to contain) lives in the domain service.
pub trait DatabasesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Insert a database, its starter table, and the creator's owner grant in
    /// one transaction, so a database can never exist without an owner.
    fn create_database(
        &self,
        cmd: &CreateDatabase,
        starter_table_name: &str,
    ) -> impl Future<Output = Result<Database, Self::Err>> + Send;

    /// Fetch a database with its tables and column placements.
    fn get_database(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<Option<(Database, Vec<Table>)>, Self::Err>> + Send;

    /// Set a database's display name.
    ///
    /// The caller has already checked that the database exists and is not
    /// trashed; a missing id writes nothing and is not an error here.
    fn rename_database(
        &self,
        id: DatabaseId,
        name: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Mark a database trashed (reversible; nothing else is touched).
    fn trash_database(
        &self,
        id: DatabaseId,
        trashed_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Clear a database's trashed marker.
    fn restore_database(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Irreversibly delete a database, its tables/columns/rows/links (by
    /// cascade), and every `entity_access` row pointing at it, in one
    /// transaction.
    fn delete_database(&self, id: DatabaseId)
    -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Insert a table.
    fn create_table(
        &self,
        cmd: &CreateTable,
    ) -> impl Future<Output = Result<Table, Self::Err>> + Send;

    /// Insert a column placement.
    fn create_column(
        &self,
        table_id: TableId,
        property_definition_id: PropertyDefinitionId,
        cmd: &CreateColumn,
    ) -> impl Future<Output = Result<ColumnId, Self::Err>> + Send;

    /// Bump a table's version and return the new one.
    ///
    /// For schema changes that happen outside [`DatabasesRepo::create_column`]
    /// and [`DatabasesRepo::apply_changes`] — adding a select option rewrites
    /// the table's compiled `CHECK`, so every materialization keyed on the
    /// version has to be rebuilt.
    fn bump_table_version(
        &self,
        table_id: TableId,
    ) -> impl Future<Output = Result<TableVersion, Self::Err>> + Send;

    /// Fetch a table's rows in position order, at most `limit` of them.
    ///
    /// The cap is the domain's materialization budget plus one: the service
    /// refuses a table that comes back over the budget, and the extra row is
    /// how it tells "exactly at the budget" from "more than the budget"
    /// without loading the rest.
    fn fetch_rows(
        &self,
        table_id: TableId,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Row>, Self::Err>> + Send;

    /// Fetch the link edges for a link column.
    fn fetch_links(
        &self,
        column_id: ColumnId,
    ) -> impl Future<Output = Result<Vec<(RowId, RowId)>, Self::Err>> + Send;

    /// Apply a translated changeset atomically: inserts (returning minted row
    /// ids in changeset order), cell updates, deletes, and link edges, bumping
    /// each written table's version exactly once. When `expected_versions`
    /// names a written table, the write is refused (nothing committed) if the
    /// table's version differs — checked inside the transaction.
    fn apply_changes(
        &self,
        viewer: &Viewer,
        changes: &[RowChange],
        expected_versions: &HashMap<TableId, TableVersion>,
    ) -> impl Future<Output = Result<ApplyOutcome, Self::Err>> + Send;

    /// Current versions for a set of tables (compare-and-swap support).
    fn table_versions(
        &self,
        table_ids: &[TableId],
    ) -> impl Future<Output = Result<HashMap<TableId, TableVersion>, Self::Err>> + Send;

    /// Databases by id (missing ids are skipped).
    fn databases_by_ids(
        &self,
        ids: &[DatabaseId],
    ) -> impl Future<Output = Result<Vec<Database>, Self::Err>> + Send;

    /// Every table of the given databases, ordered by database then position.
    fn tables_for_databases(
        &self,
        database_ids: &[DatabaseId],
    ) -> impl Future<Output = Result<Vec<Table>, Self::Err>> + Send;

    /// Every column placement of the given tables, ordered by table then position.
    fn columns_for_tables(
        &self,
        table_ids: &[TableId],
    ) -> impl Future<Output = Result<Vec<Column>, Self::Err>> + Send;
}

/// Which databases a viewer can reach, and the grant written at creation.
/// Backed by the shared `entity_access` table; the domain treats it as the
/// authorization boundary for SQL (the catalog is built from it).
pub trait AccessDirectory: Send + Sync + 'static {
    /// The error type returned by directory operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Every non-trashed database the viewer holds a grant on, with the
    /// highest grant.
    fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> impl Future<Output = Result<Vec<(DatabaseId, AccessGrant)>, Self::Err>> + Send;
}

/// Column definitions live in the properties system; this port wraps creating
/// database-scoped definitions and reading definitions (with options) for
/// catalog builds and schema compilation.
pub trait ColumnDefinitionStore: Send + Sync + 'static {
    /// The error type returned by definition operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Resolve a binding: create a database-scoped definition, or validate
    /// that an existing one is visible to the viewer (system-owned, owned by
    /// the viewer or one of their teams, or owned by this database).
    fn resolve_binding(
        &self,
        database_id: DatabaseId,
        viewer: &Viewer,
        binding: &ColumnBinding,
    ) -> impl Future<Output = Result<PropertyDefinitionId, Self::Err>> + Send;

    /// Append select options to a definition, returning the created rows in
    /// the order given.
    ///
    /// Mechanics only: the caller has already checked that the definition
    /// takes options and that none of these values is on it yet, and has
    /// turned each display label into the value the properties system stores
    /// (a number for [`models_properties::shared::DataType::SelectNumber`], a
    /// string otherwise).
    fn add_options(
        &self,
        definition_id: PropertyDefinitionId,
        values: &[PropertyOptionValue],
    ) -> impl Future<Output = Result<Vec<PropertyOption>, Self::Err>> + Send;

    /// Fetch the definitions (with options) behind a set of column placements.
    fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, Self::Err>> + Send;
}

/// Platform data exposed to SQL, permission-scoped per viewer. One
/// implementation dispatches across every magic table (`people`, `documents`,
/// `tasks`, …); the domain never knows which backends exist.
pub trait MagicTables: Send + Sync + 'static {
    /// The error type returned by magic-table operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Schemas of every magic table, for the catalog. Cheap and static.
    fn schemas(&self) -> Vec<crate::domain::models::TableSchema>;

    /// Materialize one magic table for a viewer, restricted to the referenced
    /// columns, plus whether the row cap truncated it. Never called for tables
    /// absent from [`MagicTables::schemas`].
    fn materialize(
        &self,
        viewer: &Viewer,
        sql_name: &str,
        columns: &[String],
    ) -> impl Future<Output = Result<(MaterializedTable, bool), Self::Err>> + Send;
}

/// The embedded SQLite sandbox. Synchronous and CPU-bound; the service runs it
/// on a blocking pool. Implemented by the rusqlite executor.
pub trait SqlExecutor: Send + Sync + 'static {
    /// Prepare `sql` against a schema-only build of `catalog` and report the
    /// tables/columns it references and writes (via the authorizer), or the
    /// SQLite error verbatim. No data is loaded and nothing executes.
    fn analyze(&self, catalog: &Catalog, sql: &str) -> Result<TableDeps, QueryError>;

    /// Load `tables` into a fresh in-memory database whose schema carries the
    /// compiled validity constraints, execute `sql` inside one transaction
    /// with a session recording changes, and return SELECT results plus the
    /// recorded row changes. Enforces read-only tables, statement budget, and
    /// row caps via the authorizer/interrupt handler.
    fn execute(
        &self,
        catalog: &Catalog,
        tables: Vec<MaterializedTable>,
        sql: &str,
    ) -> Result<(Vec<QueryResult>, Vec<RawRowChange>), QueryError>;

    /// Serialize a set of materialized tables into a complete SQLite database
    /// file (the takeout snapshot).
    fn serialize_snapshot(&self, tables: Vec<MaterializedTable>) -> Result<Vec<u8>, QueryError>;
}

/// Liveness fan-out: announce that a table changed so subscribed surfaces
/// re-run their queries. Implemented by the Redis publisher.
pub trait TableEventPublisher: Send + Sync + 'static {
    /// The error type returned by publish operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Publish `{database_id, table_id, version}` to the gateway fan-out.
    fn table_changed(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        version: TableVersion,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The service trait inbound adapters call. All authorization policy beyond
/// receipt minting, and all use-case orchestration, lives behind this trait.
pub trait DatabasesService: Send + Sync + 'static {
    /// Create a database (with one starter table) owned by the viewer.
    fn create_database(
        &self,
        cmd: CreateDatabase,
    ) -> impl Future<Output = Result<Database, DatabaseError>> + Send;

    /// Every database the viewer can reach.
    fn list_databases(
        &self,
        viewer: Viewer,
    ) -> impl Future<Output = Result<Vec<ListedDatabase>, DatabaseError>> + Send;

    /// Fetch a database with tables, columns, definitions, and SQL names.
    fn get_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
    ) -> impl Future<Output = Result<DatabaseDetail, DatabaseError>> + Send;

    /// Rename a database. A trashed database is indistinguishable from a
    /// missing one.
    fn rename_database(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> impl Future<Output = Result<Database, DatabaseError>> + Send;

    /// Move a database to the trash. Idempotent: trashing an already-trashed
    /// database succeeds without changing when it was trashed.
    fn trash_database(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Restore a trashed database. Idempotent for a live database.
    fn restore_database(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Irreversibly delete a database and everything under it.
    fn delete_database_permanently(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), DatabaseError>> + Send;

    /// Create a table.
    fn create_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: CreateTable,
    ) -> impl Future<Output = Result<Table, DatabaseError>> + Send;

    /// Create a column: validate the binding and any link target against the
    /// viewer's world, resolve the definition, insert the placement.
    fn create_column(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: CreateColumn,
    ) -> impl Future<Output = Result<ColumnId, DatabaseError>> + Send;

    /// Extend a select column's allowed options.
    ///
    /// Options are part of the compiled schema (a `CHECK` on the column), so
    /// this bumps the table's version and announces the change. Add-only, and
    /// idempotent: a label the column already has is ignored.
    fn add_column_options(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: AddColumnOptions,
    ) -> impl Future<Output = Result<ColumnDetail, DatabaseError>> + Send;

    /// Execute SQL for a viewer — the whole read/write surface.
    ///
    /// Pipeline: build catalog → desugar → analyze → check writability &
    /// `base_versions` → materialize referenced tables → sandboxed execute →
    /// translate changeset → apply to Postgres → publish version events.
    fn exec_sql(
        &self,
        viewer: Viewer,
        req: ExecRequest,
    ) -> impl Future<Output = Result<ExecOutcome, QueryError>> + Send;

    /// Serialize one database into a SQLite file for takeout/local analysis.
    fn sqlite_snapshot(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
    ) -> impl Future<Output = Result<SqliteSnapshot, QueryError>> + Send;
}
