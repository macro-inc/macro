//! Databases service implementation.
//!
//! All authorization policy (beyond receipt minting at the edge) and all
//! use-case orchestration live here, behind fake-able ports. The SQL surface
//! is authorized by construction: the catalog handed to the executor is built
//! from the viewer's grants, so an unreadable table does not exist and an
//! unwritable one is compiled read-only.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessReceipt, EntityPermission, OwnerAccessLevel,
    RequiredPermission, ViewAccessLevel,
};
use uuid::Uuid;

use crate::domain::catalog::{self, JunctionKind, TableEntry};
use crate::domain::materialize;
use crate::domain::models::{
    AccessGrant, ApplyOutcome, Catalog, ColumnBinding, ColumnConfig, ColumnDetail, ColumnId,
    CreateColumn, CreateDatabase, CreateTable, Database, DatabaseDetail, DatabaseError, DatabaseId,
    ExecOutcome, ExecRequest, ListedDatabase, MaterializedTable, QueryError, QueryResult,
    RawRowChange, Row, RowChange, RowId, SqliteSnapshot, Table, TableDeps, TableDetail, TableId,
    TableSchema, TableSource, TableVersion, Viewer,
};
use crate::domain::ports::{
    AccessDirectory, ColumnDefinitionStore, DatabasesRepo, DatabasesService, MagicTables,
    SqlExecutor, TableEventPublisher,
};
use crate::domain::sugar::desugar;
use crate::domain::translate::translate;

/// Name of the table every new database starts with.
const STARTER_TABLE_NAME: &str = "Table 1";
/// Longest accepted database/table/column name.
const MAX_NAME_LEN: usize = 200;
/// Longest accepted statement text; SQLite enforces the same cap.
const MAX_SQL_LEN: usize = 256 * 1024;
/// Most rows any one table may contribute to a materialization.
const MAX_MATERIALIZED_ROWS: usize = 200_000;

/// Concrete databases service backed by its ports.
#[derive(Debug, Clone)]
pub struct DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access> {
    repo: Repo,
    definitions: Defs,
    magic: Magic,
    executor: Arc<Exec>,
    events: Events,
    access: Access,
}

fn infra<E: std::error::Error + Send + Sync + 'static>(e: E) -> QueryError {
    QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic())
}

fn repo_err<E: std::error::Error + Send + Sync + 'static>(e: E) -> DatabaseError {
    DatabaseError::Repo(rootcause::Report::new(e).into_dynamic())
}

fn receipt_database_id<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<DatabaseId, DatabaseError> {
    Uuid::parse_str(&receipt.entity().entity_id).map_err(|_| DatabaseError::NotFound)
}

impl From<AccessLevel> for AccessGrant {
    fn from(level: AccessLevel) -> Self {
        match level {
            AccessLevel::View => AccessGrant::View,
            AccessLevel::Comment => AccessGrant::Comment,
            AccessLevel::Edit => AccessGrant::Edit,
            AccessLevel::Owner => AccessGrant::Owner,
        }
    }
}

/// The grant a receipt proves. Receipts minted for internal callers carry no
/// level; the extractor already enforced the route's requirement, so they
/// get exactly `floor`.
fn receipt_grant<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    floor: AccessGrant,
) -> AccessGrant {
    match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => AccessGrant::from(*access_level),
        _ => floor,
    }
}

fn validate_name(name: &str) -> Result<String, DatabaseError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(DatabaseError::InvalidSchemaOperation(
            "name must not be empty".into(),
        ));
    }
    if trimmed.chars().count() > MAX_NAME_LEN {
        return Err(DatabaseError::InvalidSchemaOperation(format!(
            "name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn same_name(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// The viewer's catalog plus the entries needed to materialize and translate.
struct ViewerCatalog {
    entries: Vec<TableEntry>,
    catalog: Catalog,
}

/// Rows and link edges loaded for a materialization, reused across tables.
#[derive(Default)]
struct Loaded {
    rows: HashMap<TableId, Vec<Row>>,
    links: HashMap<ColumnId, HashMap<RowId, Vec<RowId>>>,
}

impl<Repo, Defs, Magic, Exec, Events, Access>
    DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
    Access: AccessDirectory,
{
    /// Create a databases service from its port implementations.
    pub fn new(
        repo: Repo,
        definitions: Defs,
        magic: Magic,
        executor: Exec,
        events: Events,
        access: Access,
    ) -> Self {
        Self {
            repo,
            definitions,
            magic,
            executor: Arc::new(executor),
            events,
            access,
        }
    }

    /// Build catalog entries for a set of databases the viewer holds grants on.
    async fn entries_for(
        &self,
        grants: &HashMap<DatabaseId, AccessGrant>,
    ) -> Result<Vec<TableEntry>, QueryError> {
        let database_ids: Vec<DatabaseId> = grants.keys().copied().collect();
        let mut databases = self
            .repo
            .databases_by_ids(&database_ids)
            .await
            .map_err(infra)?;
        databases.retain(|d| d.trashed_at.is_none());
        let live_ids: Vec<DatabaseId> = databases.iter().map(|d| d.id).collect();
        let tables = self
            .repo
            .tables_for_databases(&live_ids)
            .await
            .map_err(infra)?;
        let table_ids: Vec<TableId> = tables.iter().map(|t| t.id).collect();
        let columns = self
            .repo
            .columns_for_tables(&table_ids)
            .await
            .map_err(infra)?;
        let definition_ids: Vec<Uuid> = columns
            .iter()
            .map(|c| c.property_definition_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let definitions = self
            .definitions
            .definitions(&definition_ids)
            .await
            .map_err(infra)?
            .into_iter()
            .map(|d| (d.definition.id, d))
            .collect();
        let reserved: Vec<String> = self
            .magic
            .schemas()
            .into_iter()
            .map(|s| s.sql_name)
            .collect();
        Ok(catalog::build_user_tables(
            &databases,
            &tables,
            &columns,
            &definitions,
            grants,
            &reserved,
        ))
    }

    /// Every grant the viewer holds, with `grant` on `database_id` (the one a
    /// receipt just proved) taking precedence. SQL names are only meaningful
    /// against the same set of tables `exec_sql` sees, so schema reads must
    /// name tables against the whole catalog, not one database in isolation.
    async fn viewer_grants(
        &self,
        viewer: &Viewer,
        database_id: DatabaseId,
        grant: AccessGrant,
    ) -> Result<HashMap<DatabaseId, AccessGrant>, Access::Err> {
        let mut grants: HashMap<DatabaseId, AccessGrant> = self
            .access
            .accessible_databases(viewer)
            .await?
            .into_iter()
            .collect();
        grants.insert(database_id, grant);
        Ok(grants)
    }

    /// The catalog entries that belong to one database, catalog names intact.
    fn entries_of(entries: Vec<TableEntry>, database_id: DatabaseId) -> Vec<TableEntry> {
        entries
            .into_iter()
            .filter(|entry| entry.table.database_id == database_id)
            .collect()
    }

    /// The viewer's whole queryable world — the authorization boundary for SQL.
    async fn build_catalog(&self, viewer: &Viewer) -> Result<ViewerCatalog, QueryError> {
        let grants: HashMap<DatabaseId, AccessGrant> = self
            .access
            .accessible_databases(viewer)
            .await
            .map_err(infra)?
            .into_iter()
            .collect();
        let entries = self.entries_for(&grants).await?;
        let mut tables: Vec<TableSchema> = catalog::schemas(&entries).collect();
        tables.extend(self.magic.schemas());
        Ok(ViewerCatalog {
            entries,
            catalog: Catalog { tables },
        })
    }

    /// Load rows and link edges for one table entry (rows once per table).
    async fn load_table(&self, entry: &TableEntry, loaded: &mut Loaded) -> Result<(), QueryError> {
        if let std::collections::hash_map::Entry::Vacant(slot) = loaded.rows.entry(entry.table.id) {
            let fetched = self.repo.fetch_rows(entry.table.id).await.map_err(infra)?;
            if fetched.len() > MAX_MATERIALIZED_ROWS {
                return Err(QueryError::BudgetExceeded);
            }
            slot.insert(fetched);
        }
        for junction in &entry.junctions {
            if junction.kind == JunctionKind::Link
                && !loaded.links.contains_key(&junction.column_id)
            {
                let edges = self
                    .repo
                    .fetch_links(junction.column_id)
                    .await
                    .map_err(infra)?;
                let mut by_source: HashMap<RowId, Vec<RowId>> = HashMap::new();
                for (source, target) in edges {
                    by_source.entry(source).or_default().push(target);
                }
                loaded.links.insert(junction.column_id, by_source);
            }
        }
        Ok(())
    }

    /// Materialize exactly the tables a statement references (plus the parent
    /// of any junction, so its foreign key resolves). Returns the tables and
    /// the names of magic tables that were truncated.
    async fn materialize_deps(
        &self,
        viewer: &Viewer,
        entries: &[TableEntry],
        deps: &TableDeps,
        loaded: &mut Loaded,
    ) -> Result<(Vec<MaterializedTable>, Vec<String>), QueryError> {
        let mut out: Vec<MaterializedTable> = Vec::new();
        let mut truncated: Vec<String> = Vec::new();
        let mut emitted: HashSet<TableId> = HashSet::new();
        let mut emitted_junctions: HashSet<ColumnId> = HashSet::new();
        let mut emitted_magic: HashSet<String> = HashSet::new();

        let mut wanted: Vec<String> = deps.tables.keys().cloned().collect();
        wanted.sort();

        for name in wanted {
            if let Some(entry) = entries.iter().find(|e| catalog::entry_answers_to(e, &name)) {
                if emitted.insert(entry.table.id) {
                    self.load_table(entry, loaded).await?;
                    out.push(materialize::user_table(
                        entry,
                        &loaded.rows[&entry.table.id],
                        &loaded.links,
                    ));
                }
                continue;
            }
            if let Some((entry, junction)) = entries.iter().find_map(|e| {
                e.junctions
                    .iter()
                    .find(|j| catalog::junction_answers_to(j, &name))
                    .map(|j| (e, j))
            }) {
                // The parent table must exist for the junction's foreign key.
                if emitted.insert(entry.table.id) {
                    self.load_table(entry, loaded).await?;
                    out.push(materialize::user_table(
                        entry,
                        &loaded.rows[&entry.table.id],
                        &loaded.links,
                    ));
                }
                if emitted_junctions.insert(junction.column_id) {
                    out.push(materialize::junction(
                        entry,
                        junction,
                        &loaded.rows[&entry.table.id],
                        &loaded.links,
                    ));
                }
                continue;
            }
            if !emitted_magic.insert(name.clone()) {
                continue;
            }
            let columns = deps
                .tables
                .get(&name)
                .map(|t| t.read_columns.clone())
                .unwrap_or_default();
            let (table, was_truncated) = self
                .magic
                .materialize(viewer, &name, &columns)
                .await
                .map_err(infra)?;
            if was_truncated {
                truncated.push(name);
            }
            out.push(table);
        }
        Ok((out, truncated))
    }

    /// Materialize every table and junction of the given entries (snapshots).
    async fn materialize_all(
        &self,
        entries: &[TableEntry],
    ) -> Result<Vec<MaterializedTable>, QueryError> {
        let mut loaded = Loaded::default();
        let mut out = Vec::new();
        for entry in entries {
            self.load_table(entry, &mut loaded).await?;
            out.push(materialize::user_table(
                entry,
                &loaded.rows[&entry.table.id],
                &loaded.links,
            ));
            for junction in &entry.junctions {
                out.push(materialize::junction(
                    entry,
                    junction,
                    &loaded.rows[&entry.table.id],
                    &loaded.links,
                ));
            }
        }
        Ok(out)
    }

    /// Link edges may only connect rows of the junction's own table to rows of
    /// the column's configured target table; SQL cannot forge either end.
    async fn validate_links(
        &self,
        changes: &[RowChange],
        entries: &[TableEntry],
        loaded: &mut Loaded,
    ) -> Result<(), QueryError> {
        for change in changes {
            let (RowChange::Link {
                column_id,
                source_row_id,
                target_row_id,
            }
            | RowChange::Unlink {
                column_id,
                source_row_id,
                target_row_id,
            }) = change
            else {
                continue;
            };
            let (entry, column) = entries
                .iter()
                .find_map(|e| {
                    e.columns
                        .iter()
                        .find(|c| c.column.id == *column_id)
                        .map(|c| (e, c))
                })
                .ok_or_else(|| QueryError::UntranslatableChange("unknown link column".into()))?;
            let Some(ColumnConfig::Link {
                table_id: target_table,
                ..
            }) = &column.column.config
            else {
                return Err(QueryError::UntranslatableChange(format!(
                    "{} is not a link column",
                    column.sql_name
                )));
            };
            let target_entry = entries
                .iter()
                .find(|e| e.table.id == *target_table)
                .ok_or_else(|| {
                    QueryError::ReadOnly(format!(
                        "link target table of {} is not accessible",
                        column.sql_name
                    ))
                })?;
            self.load_table(entry, loaded).await?;
            self.load_table(target_entry, loaded).await?;
            let has_row = |table: TableId, row: RowId| {
                loaded
                    .rows
                    .get(&table)
                    .is_some_and(|rows| rows.iter().any(|r| r.id == row))
            };
            if !has_row(entry.table.id, *source_row_id) {
                return Err(QueryError::UntranslatableChange(format!(
                    "{source_row_id} is not a row of {}",
                    entry.schema.sql_name
                )));
            }
            if !has_row(target_entry.table.id, *target_row_id) {
                return Err(QueryError::UntranslatableChange(format!(
                    "{target_row_id} is not a row of {}",
                    target_entry.schema.sql_name
                )));
            }
        }
        Ok(())
    }

    fn detail(database: Database, grant: AccessGrant, entries: Vec<TableEntry>) -> DatabaseDetail {
        DatabaseDetail {
            database,
            grant,
            tables: entries
                .into_iter()
                .map(|entry| TableDetail {
                    sql_name: entry.schema.sql_name,
                    table: entry.table,
                    columns: entry
                        .columns
                        .into_iter()
                        .map(|c| ColumnDetail {
                            column: c.column,
                            sql_name: c.sql_name,
                            definition: c.definition,
                            writable: c.writable,
                        })
                        .collect(),
                })
                .collect(),
        }
    }

    async fn publish(
        &self,
        database_of: &HashMap<TableId, DatabaseId>,
        versions: &HashMap<TableId, TableVersion>,
    ) {
        for (table_id, version) in versions {
            let Some(database_id) = database_of.get(table_id) else {
                continue;
            };
            if let Err(error) = self
                .events
                .table_changed(*database_id, *table_id, *version)
                .await
            {
                // Liveness is best-effort: the write already committed.
                tracing::warn!(error = ?error, %table_id, "failed to publish table change");
            }
        }
    }

    /// Run the CPU-bound executor off the async runtime.
    async fn blocking<T, F>(&self, f: F) -> Result<T, QueryError>
    where
        T: Send + 'static,
        F: FnOnce(&Exec) -> Result<T, QueryError> + Send + 'static,
    {
        let executor = self.executor.clone();
        tokio::task::spawn_blocking(move || f(&executor))
            .await
            .map_err(|e| QueryError::Infrastructure(rootcause::Report::new(e).into_dynamic()))?
    }

    async fn database_for_edit(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(Database, Vec<Table>), DatabaseError> {
        let database_id = receipt_database_id(receipt)?;
        let (database, tables) = self
            .repo
            .get_database(database_id)
            .await
            .map_err(repo_err)?
            .ok_or(DatabaseError::NotFound)?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        Ok((database, tables))
    }

    /// The receipted database regardless of its trash state — the lifecycle
    /// operations (trash, restore, permanent delete) act on trashed rows too.
    async fn database_by_receipt<T: RequiredPermission>(
        &self,
        receipt: &EntityAccessReceipt<T>,
    ) -> Result<Database, DatabaseError> {
        let database_id = receipt_database_id(receipt)?;
        let (database, _tables) = self
            .repo
            .get_database(database_id)
            .await
            .map_err(repo_err)?
            .ok_or(DatabaseError::NotFound)?;
        Ok(database)
    }
}

impl<Repo, Defs, Magic, Exec, Events, Access> DatabasesService
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
    Access: AccessDirectory,
{
    #[tracing::instrument(skip(self), err)]
    async fn create_database(&self, cmd: CreateDatabase) -> Result<Database, DatabaseError> {
        let cmd = CreateDatabase {
            name: validate_name(&cmd.name)?,
            owner_id: cmd.owner_id,
        };
        self.repo
            .create_database(&cmd, STARTER_TABLE_NAME)
            .await
            .map_err(repo_err)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn rename_database(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        name: String,
    ) -> Result<Database, DatabaseError> {
        // Renaming a trashed database is refused the same way a missing one
        // is: restore it first.
        let (database, _tables) = self.database_for_edit(&receipt).await?;
        let name = validate_name(&name)?;
        self.repo
            .rename_database(database.id, &name)
            .await
            .map_err(repo_err)?;
        Ok(Database { name, ..database })
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn trash_database(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        let database = self.database_by_receipt(&receipt).await?;
        if database.trashed_at.is_some() {
            return Ok(());
        }
        self.repo
            .trash_database(database.id, Utc::now())
            .await
            .map_err(repo_err)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn restore_database(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        let database = self.database_by_receipt(&receipt).await?;
        if database.trashed_at.is_none() {
            return Ok(());
        }
        self.repo
            .restore_database(database.id)
            .await
            .map_err(repo_err)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete_database_permanently(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        // Permanent deletion does not require the database to be trashed
        // first; the receipt already proves ownership.
        let database = self.database_by_receipt(&receipt).await?;
        self.repo
            .delete_database(database.id)
            .await
            .map_err(repo_err)
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_databases(&self, viewer: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        let grants: HashMap<DatabaseId, AccessGrant> = self
            .access
            .accessible_databases(&viewer)
            .await
            .map_err(repo_err)?
            .into_iter()
            .collect();
        let ids: Vec<DatabaseId> = grants.keys().copied().collect();
        let mut databases = self.repo.databases_by_ids(&ids).await.map_err(repo_err)?;
        databases.retain(|d| d.trashed_at.is_none());
        databases.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(databases
            .into_iter()
            .filter_map(|database| {
                let grant = *grants.get(&database.id)?;
                Some(ListedDatabase { database, grant })
            })
            .collect())
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn get_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
    ) -> Result<DatabaseDetail, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let grant = receipt_grant(&receipt, AccessGrant::View);
        let (database, _tables) = self
            .repo
            .get_database(database_id)
            .await
            .map_err(repo_err)?
            .ok_or(DatabaseError::NotFound)?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        let grants = self
            .viewer_grants(&viewer, database_id, grant)
            .await
            .map_err(repo_err)?;
        let entries = self
            .entries_for(&grants)
            .await
            .map_err(|e| DatabaseError::Repo(rootcause::Report::new(e).into_dynamic()))?;
        Ok(Self::detail(
            database,
            grant,
            Self::entries_of(entries, database_id),
        ))
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn create_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: CreateTable,
    ) -> Result<Table, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        if database.id != cmd.database_id {
            return Err(DatabaseError::Unauthorized);
        }
        let name = validate_name(&cmd.name)?;
        if tables.iter().any(|t| same_name(&t.name, &name)) {
            return Err(DatabaseError::InvalidSchemaOperation(format!(
                "a table named `{name}` already exists in this database"
            )));
        }
        self.repo
            .create_table(&CreateTable {
                database_id: cmd.database_id,
                name,
            })
            .await
            .map_err(repo_err)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn create_column(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: CreateColumn,
    ) -> Result<ColumnId, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        if !tables.iter().any(|t| t.id == cmd.table_id) {
            // The receipt covers this database only; a table elsewhere is
            // indistinguishable from a missing one.
            return Err(DatabaseError::NotFound);
        }

        // A link target must be a table the viewer can at least view.
        if let Some(ColumnConfig::Link {
            database_id,
            table_id,
        }) = &cmd.config
        {
            let visible: HashMap<DatabaseId, AccessGrant> = self
                .access
                .accessible_databases(&viewer)
                .await
                .map_err(repo_err)?
                .into_iter()
                .collect();
            if !visible.contains_key(database_id) {
                return Err(DatabaseError::InvalidSchemaOperation(
                    "link target database is not accessible".into(),
                ));
            }
            let target_tables = self
                .repo
                .tables_for_databases(&[*database_id])
                .await
                .map_err(repo_err)?;
            if !target_tables.iter().any(|t| t.id == *table_id) {
                return Err(DatabaseError::InvalidSchemaOperation(
                    "link target table does not exist".into(),
                ));
            }
        }

        // Column names are unique per table (case-insensitive), matching the
        // SQL names they turn into.
        let existing = self
            .repo
            .columns_for_tables(&[cmd.table_id])
            .await
            .map_err(repo_err)?;
        let existing_ids: Vec<Uuid> = existing.iter().map(|c| c.property_definition_id).collect();
        let existing_names: Vec<String> = self
            .definitions
            .definitions(&existing_ids)
            .await
            .map_err(repo_err)?
            .into_iter()
            .map(|d| d.definition.display_name)
            .collect();
        let binding = match cmd.binding {
            ColumnBinding::NewDefinition {
                name,
                data_type,
                is_multi_select,
            } => ColumnBinding::NewDefinition {
                name: validate_name(&name)?,
                data_type,
                is_multi_select,
            },
            other => other,
        };
        if let ColumnBinding::NewDefinition { name, .. } = &binding
            && existing_names.iter().any(|n| same_name(n, name))
        {
            return Err(DatabaseError::InvalidSchemaOperation(format!(
                "a column named `{name}` already exists on this table"
            )));
        }
        if let ColumnBinding::ExistingDefinition(id) = &binding
            && existing_ids.contains(id)
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "that property is already a column of this table".into(),
            ));
        }

        let definition_id = self
            .definitions
            .resolve_binding(database.id, &viewer, &binding)
            .await
            .map_err(|e| DatabaseError::InvalidSchemaOperation(e.to_string()))?;
        let cmd = CreateColumn { binding, ..cmd };
        let column_id = self
            .repo
            .create_column(cmd.table_id, definition_id, &cmd)
            .await
            .map_err(repo_err)?;
        if let Ok(versions) = self.repo.table_versions(&[cmd.table_id]).await {
            self.publish(&HashMap::from([(cmd.table_id, database.id)]), &versions)
                .await;
        }
        Ok(column_id)
    }

    #[tracing::instrument(skip(self, req), err)]
    async fn exec_sql(&self, viewer: Viewer, req: ExecRequest) -> Result<ExecOutcome, QueryError> {
        if req.sql.len() > MAX_SQL_LEN {
            return Err(QueryError::BudgetExceeded);
        }
        let ViewerCatalog { entries, catalog } = self.build_catalog(&viewer).await?;
        let sql = desugar(&req.sql);

        let deps = {
            let catalog = catalog.clone();
            let sql = sql.clone();
            self.blocking(move |exec| exec.analyze(&catalog, &sql))
                .await?
        };

        // Fail early with a precise reason; the executor's authorizer enforces
        // the same policy during execution.
        let mut written_tables: Vec<TableId> = Vec::new();
        for (name, referenced) in &deps.tables {
            if !referenced.written {
                continue;
            }
            let schema = catalog
                .tables
                .iter()
                .find(|t| &t.sql_name == name || t.aliases.iter().any(|a| a == name))
                .ok_or_else(|| QueryError::Sql(format!("no such table: {name}")))?;
            if !schema.writable || &schema.sql_name != name {
                return Err(QueryError::ReadOnly(format!("table {name} is read-only")));
            }
            match schema.source {
                TableSource::UserTable(table_id) | TableSource::Junction { table_id, .. } => {
                    if !written_tables.contains(&table_id) {
                        written_tables.push(table_id);
                    }
                }
                TableSource::Magic(_) => {
                    return Err(QueryError::ReadOnly(format!("table {name} is read-only")));
                }
            }
        }

        let mut loaded = Loaded::default();
        let (tables, truncated_tables) = self
            .materialize_deps(&viewer, &entries, &deps, &mut loaded)
            .await?;
        let (results, raw_changes): (Vec<QueryResult>, Vec<RawRowChange>) = {
            let catalog = catalog.clone();
            let sql = sql.clone();
            self.blocking(move |exec| exec.execute(&catalog, tables, &sql))
                .await?
        };
        let changes = translate(raw_changes, &entries)?;
        self.validate_links(&changes, &entries, &mut loaded).await?;

        let expected_versions: HashMap<TableId, TableVersion> = req
            .base_versions
            .unwrap_or_default()
            .into_iter()
            .filter(|(table_id, _)| written_tables.contains(table_id))
            .collect();
        let (inserted_row_ids, new_versions) = if changes.is_empty() {
            (Vec::new(), HashMap::new())
        } else {
            match self
                .repo
                .apply_changes(&viewer, &changes, &expected_versions)
                .await
                .map_err(infra)?
            {
                ApplyOutcome::Applied(applied) => applied,
                ApplyOutcome::VersionConflict { table_id } => {
                    return Err(QueryError::VersionConflict { table_id });
                }
            }
        };
        let database_of: HashMap<TableId, DatabaseId> = entries
            .iter()
            .map(|e| (e.table.id, e.table.database_id))
            .collect();
        self.publish(&database_of, &new_versions).await;

        let read_tables = deps
            .tables
            .keys()
            .filter_map(|name| {
                entries
                    .iter()
                    .find(|e| {
                        catalog::entry_answers_to(e, name)
                            || e.junctions
                                .iter()
                                .any(|j| catalog::junction_answers_to(j, name))
                    })
                    .map(|e| e.table.id)
            })
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        Ok(ExecOutcome {
            results,
            changes_applied: changes.len(),
            inserted_row_ids,
            new_versions,
            read_tables,
            truncated_tables,
        })
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn sqlite_snapshot(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
    ) -> Result<SqliteSnapshot, QueryError> {
        let database_id = receipt_database_id(&receipt)
            .map_err(|_| QueryError::Sql("database not found".to_string()))?;
        let grants = self
            .viewer_grants(
                &viewer,
                database_id,
                receipt_grant(&receipt, AccessGrant::View),
            )
            .await
            .map_err(infra)?;
        let entries = Self::entries_of(self.entries_for(&grants).await?, database_id);
        let versions = entries
            .iter()
            .map(|e| (e.table.id, e.table.version))
            .collect();
        let tables = self.materialize_all(&entries).await?;
        let bytes = self
            .blocking(move |exec| exec.serialize_snapshot(tables))
            .await?;
        Ok(SqliteSnapshot { bytes, versions })
    }
}
