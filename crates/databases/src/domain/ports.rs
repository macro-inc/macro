//! Ports (trait contracts) for the databases domain.

use std::collections::HashMap;

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::{
    AccessGrant, AppliedChanges, Catalog, Column, ColumnBinding, ColumnId, CreateColumn,
    CreateDatabase, CreateTable, Database, DatabaseDetail, DatabaseError, DatabaseId, ExecOutcome,
    ExecRequest, ListedDatabase, MaterializedTable, PropertyDefinitionId, QueryError, QueryResult,
    RawRowChange, Row, RowChange, RowId, SqliteSnapshot, Table, TableDeps, TableId, TableVersion,
    Viewer,
};

/// Outbound persistence port for databases, tables, column placements, rows,
/// and link edges. Implemented by the Postgres repository.
///
/// The repo stores facts; every policy decision (who may do what, what a
/// changeset is allowed to contain) lives in the domain service.
pub trait DatabasesRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Insert a database (and nothing else — the starter table is a separate call).
    fn create_database(
        &self,
        cmd: &CreateDatabase,
    ) -> impl Future<Output = Result<Database, Self::Err>> + Send;

    /// Fetch a database with its tables and column placements.
    fn get_database(
        &self,
        id: DatabaseId,
    ) -> impl Future<Output = Result<Option<(Database, Vec<Table>)>, Self::Err>> + Send;

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

    /// Fetch every row of a table.
    fn fetch_rows(
        &self,
        table_id: TableId,
    ) -> impl Future<Output = Result<Vec<Row>, Self::Err>> + Send;

    /// Fetch the link edges for a link column.
    fn fetch_links(
        &self,
        column_id: ColumnId,
    ) -> impl Future<Output = Result<Vec<(RowId, RowId)>, Self::Err>> + Send;

    /// Apply a translated changeset atomically: inserts (returning minted row
    /// ids in changeset order), cell updates, deletes, and link edges, bumping
    /// each written table's version exactly once.
    fn apply_changes(
        &self,
        viewer: &Viewer,
        changes: &[RowChange],
    ) -> impl Future<Output = Result<AppliedChanges, Self::Err>> + Send;

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

    /// Every database the viewer holds a grant on, with the highest grant.
    fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> impl Future<Output = Result<Vec<(DatabaseId, AccessGrant)>, Self::Err>> + Send;

    /// Record the creator as owner of a new database.
    fn grant_owner(
        &self,
        database_id: DatabaseId,
        owner: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Column definitions live in the properties system; this port wraps creating
/// database-scoped definitions and reading definitions (with options) for
/// catalog builds and schema compilation.
pub trait ColumnDefinitionStore: Send + Sync + 'static {
    /// The error type returned by definition operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Resolve a binding: create a database-scoped definition or validate an
    /// existing one, returning the definition id.
    fn resolve_binding(
        &self,
        database_id: DatabaseId,
        binding: &ColumnBinding,
    ) -> impl Future<Output = Result<PropertyDefinitionId, Self::Err>> + Send;

    /// Fetch the definitions (with options) behind a set of column placements.
    fn definitions(
        &self,
        ids: &[PropertyDefinitionId],
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, Self::Err>> + Send;

    /// Resolve a select/tag display value to an option id for the definition,
    /// used when translating changeset cell values back to `SetPropertyValue`.
    fn resolve_option(
        &self,
        definition_id: PropertyDefinitionId,
        display_value: &str,
    ) -> impl Future<Output = Result<Option<uuid::Uuid>, Self::Err>> + Send;
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
    /// columns. Never called for tables absent from [`MagicTables::schemas`].
    fn materialize(
        &self,
        viewer: &Viewer,
        sql_name: &str,
        columns: &[String],
    ) -> impl Future<Output = Result<MaterializedTable, Self::Err>> + Send;
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

    /// Publish `{table_id, version}` to the gateway fan-out.
    fn table_changed(
        &self,
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

    /// Create a table.
    fn create_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: CreateTable,
    ) -> impl Future<Output = Result<Table, DatabaseError>> + Send;

    /// Create a column: resolve the definition binding, insert the placement.
    fn create_column(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: CreateColumn,
    ) -> impl Future<Output = Result<ColumnId, DatabaseError>> + Send;

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
