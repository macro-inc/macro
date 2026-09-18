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

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityPermission, RequiredPermission, ViewAccessLevel,
};
use uuid::Uuid;

use crate::domain::catalog::{self, JunctionKind, TableEntry};
use crate::domain::materialize;
use crate::domain::models::{
    AccessGrant, Catalog, ColumnBinding, ColumnDetail, ColumnId, CreateColumn, CreateDatabase,
    CreateTable, Database, DatabaseDetail, DatabaseError, DatabaseId, ExecOutcome, ExecRequest,
    ListedDatabase, MaterializedTable, QueryError, Row, RowId, SqliteSnapshot, Table, TableDeps,
    TableDetail, TableId, TableSchema, TableSource, Viewer,
};
use crate::domain::ports::{
    AccessDirectory, ColumnDefinitionStore, DatabasesRepo, DatabasesService, MagicTables,
    SqlExecutor, TableEventPublisher,
};
use crate::domain::sugar::desugar;
use crate::domain::translate::translate;

/// Name of the table every new database starts with.
const STARTER_TABLE_NAME: &str = "Table 1";
/// Longest accepted database/table name.
const MAX_NAME_LEN: usize = 200;

/// Concrete databases service backed by its ports.
#[derive(Debug, Clone)]
pub struct DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access> {
    repo: Repo,
    definitions: Defs,
    magic: Magic,
    executor: Exec,
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

fn receipt_grant<T: RequiredPermission>(receipt: &EntityAccessReceipt<T>) -> AccessGrant {
    match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => {
            AccessGrant::parse(&format!("{access_level:?}")).unwrap_or(AccessGrant::View)
        }
        // Receipts minted for internal callers or roles carry no level; the
        // extractor already proved the required permission, so grant exactly
        // what the route asked for.
        _ => {
            if std::any::type_name::<T>().contains("Edit")
                || std::any::type_name::<T>().contains("Owner")
            {
                AccessGrant::Edit
            } else {
                AccessGrant::View
            }
        }
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

/// The viewer's catalog plus the entries needed to materialize and translate.
struct ViewerCatalog {
    entries: Vec<TableEntry>,
    catalog: Catalog,
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
            executor,
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
        let tables = self
            .repo
            .tables_for_databases(&database_ids)
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
        Ok(catalog::build_user_tables(
            &tables,
            &columns,
            &definitions,
            grants,
        ))
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
    async fn load_table(
        &self,
        entry: &TableEntry,
        rows: &mut HashMap<TableId, Vec<Row>>,
        links: &mut HashMap<ColumnId, HashMap<RowId, Vec<RowId>>>,
    ) -> Result<(), QueryError> {
        if !rows.contains_key(&entry.table.id) {
            let fetched = self.repo.fetch_rows(entry.table.id).await.map_err(infra)?;
            rows.insert(entry.table.id, fetched);
        }
        for junction in &entry.junctions {
            if junction.kind == JunctionKind::Link && !links.contains_key(&junction.column_id) {
                let edges = self
                    .repo
                    .fetch_links(junction.column_id)
                    .await
                    .map_err(infra)?;
                let mut by_source: HashMap<RowId, Vec<RowId>> = HashMap::new();
                for (source, target) in edges {
                    by_source.entry(source).or_default().push(target);
                }
                links.insert(junction.column_id, by_source);
            }
        }
        Ok(())
    }

    /// Materialize exactly the tables a statement references (plus the parent
    /// of any junction, so its foreign key resolves).
    async fn materialize_deps(
        &self,
        viewer: &Viewer,
        entries: &[TableEntry],
        deps: &TableDeps,
    ) -> Result<Vec<MaterializedTable>, QueryError> {
        let mut rows: HashMap<TableId, Vec<Row>> = HashMap::new();
        let mut links: HashMap<ColumnId, HashMap<RowId, Vec<RowId>>> = HashMap::new();
        let mut out: Vec<MaterializedTable> = Vec::new();
        let mut emitted: HashSet<String> = HashSet::new();

        let mut wanted: Vec<String> = deps.tables.keys().cloned().collect();
        wanted.sort();
        // Junction parents must exist for their foreign keys.
        for entry in entries {
            if entry
                .junctions
                .iter()
                .any(|j| deps.tables.contains_key(&j.schema.sql_name))
                && !wanted.contains(&entry.schema.sql_name)
            {
                wanted.push(entry.schema.sql_name.clone());
            }
        }

        for name in wanted {
            if !emitted.insert(name.clone()) {
                continue;
            }
            if let Some(entry) = entries.iter().find(|e| e.schema.sql_name == name) {
                self.load_table(entry, &mut rows, &mut links).await?;
                out.push(materialize::user_table(
                    entry,
                    &rows[&entry.table.id],
                    &links,
                ));
                continue;
            }
            if let Some((entry, junction)) = entries.iter().find_map(|e| {
                e.junctions
                    .iter()
                    .find(|j| j.schema.sql_name == name)
                    .map(|j| (e, j))
            }) {
                self.load_table(entry, &mut rows, &mut links).await?;
                out.push(materialize::junction(
                    entry,
                    junction,
                    &rows[&entry.table.id],
                    &links,
                ));
                continue;
            }
            let columns = deps
                .tables
                .get(&name)
                .map(|t| t.read_columns.clone())
                .unwrap_or_default();
            out.push(
                self.magic
                    .materialize(viewer, &name, &columns)
                    .await
                    .map_err(infra)?,
            );
        }
        Ok(out)
    }

    /// Materialize every table and junction of the given entries (snapshots).
    async fn materialize_all(
        &self,
        entries: &[TableEntry],
    ) -> Result<Vec<MaterializedTable>, QueryError> {
        let mut rows = HashMap::new();
        let mut links = HashMap::new();
        let mut out = Vec::new();
        for entry in entries {
            self.load_table(entry, &mut rows, &mut links).await?;
            out.push(materialize::user_table(
                entry,
                &rows[&entry.table.id],
                &links,
            ));
            for junction in &entry.junctions {
                out.push(materialize::junction(
                    entry,
                    junction,
                    &rows[&entry.table.id],
                    &links,
                ));
            }
        }
        Ok(out)
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
        versions: &HashMap<TableId, crate::domain::models::TableVersion>,
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
        let database = self.repo.create_database(&cmd).await.map_err(repo_err)?;
        self.repo
            .create_table(&CreateTable {
                database_id: database.id,
                name: STARTER_TABLE_NAME.to_string(),
            })
            .await
            .map_err(repo_err)?;
        self.access
            .grant_owner(database.id, &cmd.owner_id)
            .await
            .map_err(repo_err)?;
        Ok(database)
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
        _viewer: Viewer,
    ) -> Result<DatabaseDetail, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let grant = receipt_grant(&receipt);
        let (database, _tables) = self
            .repo
            .get_database(database_id)
            .await
            .map_err(repo_err)?
            .ok_or(DatabaseError::NotFound)?;
        let grants = HashMap::from([(database_id, grant)]);
        let entries = self
            .entries_for(&grants)
            .await
            .map_err(|e| DatabaseError::Repo(rootcause::Report::new(e).into_dynamic()))?;
        Ok(Self::detail(database, grant, entries))
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn create_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: CreateTable,
    ) -> Result<Table, DatabaseError> {
        if receipt_database_id(&receipt)? != cmd.database_id {
            return Err(DatabaseError::Unauthorized);
        }
        let cmd = CreateTable {
            database_id: cmd.database_id,
            name: validate_name(&cmd.name)?,
        };
        self.repo.create_table(&cmd).await.map_err(repo_err)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn create_column(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        cmd: CreateColumn,
    ) -> Result<ColumnId, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let tables = self
            .repo
            .tables_for_databases(&[database_id])
            .await
            .map_err(repo_err)?;
        if !tables.iter().any(|t| t.id == cmd.table_id) {
            // The receipt covers this database only; a table elsewhere is
            // indistinguishable from a missing one.
            return Err(DatabaseError::NotFound);
        }
        if let ColumnBinding::NewDefinition { name, .. } = &cmd.binding {
            validate_name(name)?;
        }
        let definition_id = self
            .definitions
            .resolve_binding(database_id, &cmd.binding)
            .await
            .map_err(|e| DatabaseError::InvalidSchemaOperation(e.to_string()))?;
        let column_id = self
            .repo
            .create_column(cmd.table_id, definition_id, &cmd)
            .await
            .map_err(repo_err)?;
        if let Ok(versions) = self.repo.table_versions(&[cmd.table_id]).await {
            self.publish(&HashMap::from([(cmd.table_id, database_id)]), &versions)
                .await;
        }
        Ok(column_id)
    }

    #[tracing::instrument(skip(self, req), err)]
    async fn exec_sql(&self, viewer: Viewer, req: ExecRequest) -> Result<ExecOutcome, QueryError> {
        let ViewerCatalog { entries, catalog } = self.build_catalog(&viewer).await?;
        let sql = desugar(&req.sql);
        let deps = self.executor.analyze(&catalog, &sql)?;

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
                .find(|t| &t.sql_name == name)
                .ok_or_else(|| QueryError::Sql(format!("no such table: {name}")))?;
            if !schema.writable {
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

        if let Some(base_versions) = &req.base_versions
            && !written_tables.is_empty()
        {
            let current = self
                .repo
                .table_versions(&written_tables)
                .await
                .map_err(infra)?;
            for table_id in &written_tables {
                if let (Some(expected), Some(actual)) =
                    (base_versions.get(table_id), current.get(table_id))
                    && expected != actual
                {
                    return Err(QueryError::VersionConflict {
                        table_id: *table_id,
                    });
                }
            }
        }

        let tables = self.materialize_deps(&viewer, &entries, &deps).await?;
        let (results, raw_changes) = self.executor.execute(&catalog, tables, &sql)?;
        let changes = translate(raw_changes, &entries)?;

        let (inserted_row_ids, new_versions) = if changes.is_empty() {
            (Vec::new(), HashMap::new())
        } else {
            self.repo
                .apply_changes(&viewer, &changes)
                .await
                .map_err(infra)?
        };
        let database_of: HashMap<TableId, DatabaseId> = entries
            .iter()
            .map(|e| (e.table.id, e.table.database_id))
            .collect();
        self.publish(&database_of, &new_versions).await;

        let read_tables =
            deps.tables
                .keys()
                .filter_map(|name| {
                    catalog
                        .tables
                        .iter()
                        .find(|t| &t.sql_name == name)
                        .and_then(|t| match t.source {
                            TableSource::UserTable(id)
                            | TableSource::Junction { table_id: id, .. } => Some(id),
                            TableSource::Magic(_) => None,
                        })
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
        })
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn sqlite_snapshot(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
    ) -> Result<SqliteSnapshot, QueryError> {
        let database_id = receipt_database_id(&receipt)
            .map_err(|_| QueryError::Sql("database not found".to_string()))?;
        let grants = HashMap::from([(database_id, receipt_grant(&receipt))]);
        let entries = self.entries_for(&grants).await?;
        let versions = entries
            .iter()
            .map(|e| (e.table.id, e.table.version))
            .collect();
        let tables = self.materialize_all(&entries).await?;
        let bytes = self.executor.serialize_snapshot(tables)?;
        Ok(SqliteSnapshot { bytes, versions })
    }
}
