//! Databases service implementation.
//!
//! All authorization policy (beyond receipt minting at the edge) and all
//! use-case orchestration live here, behind fake-able ports, so allow/deny and
//! pipeline behavior are unit-testable without infrastructure.

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};

use crate::domain::models::{
    ColumnId, CreateColumn, CreateDatabase, CreateTable, Database, DatabaseError, ExecOutcome,
    ExecRequest, QueryError, SqliteSnapshot, Table, Viewer,
};
use crate::domain::ports::{
    ColumnDefinitionStore, DatabasesRepo, DatabasesService, MagicTables, SqlExecutor,
    TableEventPublisher,
};

/// Concrete databases service backed by the five ports.
// Fields are read once the todo!() implementations land.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events> {
    repo: Repo,
    definitions: Defs,
    magic: Magic,
    executor: Exec,
    events: Events,
}

impl<Repo, Defs, Magic, Exec, Events> DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
{
    /// Create a databases service from its port implementations.
    pub fn new(
        repo: Repo,
        definitions: Defs,
        magic: Magic,
        executor: Exec,
        events: Events,
    ) -> Self {
        Self {
            repo,
            definitions,
            magic,
            executor,
            events,
        }
    }

    /// Build the viewer's catalog: every table they can reference in SQL.
    ///
    /// This IS the authorization boundary for `exec_sql`: a database the
    /// viewer cannot view contributes no tables, so statements against it fail
    /// in prepare as "no such table"; tables from Edit-grant databases are
    /// writable, View-grant read-only; junction views are derived from link
    /// columns; magic-table schemas come from [`MagicTables::schemas`].
    #[allow(dead_code)]
    async fn build_catalog(
        &self,
        _viewer: &Viewer,
    ) -> Result<crate::domain::models::Catalog, QueryError> {
        todo!(
            "collect viewer-visible tables via entity_access, derive junction views, append magic schemas"
        )
    }
}

impl<Repo, Defs, Magic, Exec, Events> DatabasesService
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
{
    #[tracing::instrument(skip(self), err)]
    async fn create_database(&self, _cmd: CreateDatabase) -> Result<Database, DatabaseError> {
        todo!(
            "insert database + starter table via repo; grant owner entity_access; record activity"
        )
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_database(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<(Database, Vec<Table>), DatabaseError> {
        todo!("load database + tables + column placements + definitions for the receipted entity")
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_table(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _cmd: CreateTable,
    ) -> Result<Table, DatabaseError> {
        todo!("validate name, insert table, bump nothing (new table starts at version 0)")
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_column(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _cmd: CreateColumn,
    ) -> Result<ColumnId, DatabaseError> {
        todo!(
            "resolve_binding via ColumnDefinitionStore, validate link/lookup config, insert placement, bump table version"
        )
    }

    #[tracing::instrument(skip(self), err)]
    async fn exec_sql(&self, viewer: Viewer, req: ExecRequest) -> Result<ExecOutcome, QueryError> {
        // The whole SQL-first surface, end to end:
        //
        //  1. catalog   = self.build_catalog(&viewer)         — authz boundary
        //  2. sql       = desugar HAS → json_each membership  — pure rewrite
        //  3. deps      = self.executor.analyze(&catalog, sql) — tables/columns/writes
        //  4. reject writes to read-only tables (magic, View-grant, derived cols);
        //     if req.base_versions is set, compare against repo.table_versions
        //  5. tables    = materialize deps: repo.fetch_rows / repo.fetch_links /
        //     self.magic.materialize — permission-scoped, referenced columns only,
        //     select options resolved to display values, schema compiled with
        //     STRICT + CHECK(options) + FKs so SQLite enforces validity
        //  6. (results, changes) = self.executor.execute(...) on a blocking pool
        //  7. translate changes: display values → option ids via
        //     definitions.resolve_option, cells → SetPropertyValue (validated),
        //     junction rows → Link/Unlink
        //  8. (row_ids, versions) = repo.apply_changes(&viewer, &changes)
        //  9. events.table_changed for each written table
        // 10. ExecOutcome { results, versions, deps for liveness }
        let _ = (viewer, req);
        todo!("implement the exec pipeline described above")
    }

    #[tracing::instrument(skip(self), err)]
    async fn sqlite_snapshot(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
    ) -> Result<SqliteSnapshot, QueryError> {
        todo!(
            "materialize every table of the receipted database and executor.serialize_snapshot them"
        )
    }
}
