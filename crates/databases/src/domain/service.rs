//! Databases service implementation.
//!
//! All authorization policy (beyond receipt minting at the edge) and all
//! use-case orchestration live here, behind fake-able ports. The SQL surface
//! is authorized by construction: the catalog handed to the executor is built
//! from the viewer's grants, so an unreadable table does not exist and an
//! unwritable one is compiled read-only.

mod column_types;
mod columns;
mod infer_column_type;
mod query;
mod rename_column;
mod sharing;
mod transfer;

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use activity::Actor;
use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use macro_event_broker::MacroEventBroker;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::shared::DataType;
use uuid::Uuid;

use crate::domain::catalog::{self, JunctionKind, TableEntry};
use crate::domain::events::{
    self, DatabaseCreatedMetadata, DatabaseMacroEvent, DatabasePurgedMetadata,
    DatabaseRenamedMetadata, DatabaseRestoredMetadata, DatabaseTablesChangedMetadata,
    DatabaseTrashedMetadata, TableVersionChange,
};
use crate::domain::materialize;
use crate::domain::models::{
    AccessGrant, AddColumnOptions, Catalog, ColumnBinding, ColumnConfig, ColumnDetail, ColumnId,
    CreateColumn, CreateDatabase, CreateTable, Database, DatabaseDetail, DatabaseError, DatabaseId,
    ExecOutcome, ExecRequest, InferColumnType, InferColumnTypeOutcome, ListedDatabase,
    MaterializedTable, QueryError, RenameColumnOutcome, Row, RowChange, RowId, SqliteSnapshot,
    Table, TableDeps, TableDetail, TableId, TableMutationOutcome, TableSchema, TableVersion,
    Viewer,
};
use crate::domain::models::{ChangeColumnType, ColumnReplacement, ColumnSchemaOutcome};
use crate::domain::ports::{
    AccessDirectory, ColumnDefinitionStore, DatabasesRepo, DatabasesService, MagicTables,
    SqlExecutor, TableEventPublisher,
};

/// Name of the table every new database starts with.
const STARTER_TABLE_NAME: &str = "Table 1";
/// Longest accepted database/table/column name.
const MAX_NAME_LEN: usize = 200;
/// Longest accepted select-option label.
const MAX_OPTION_LABEL_LEN: usize = 200;
/// Longest accepted statement text; SQLite enforces the same cap.
const MAX_SQL_LEN: usize = 256 * 1024;
/// Most rows any one table may contribute to a materialization.
const MAX_MATERIALIZED_ROWS: usize = 200_000;

/// Concrete databases service backed by its ports.
///
/// `Events` is the best-effort liveness fan-out to open clients; `Broker`
/// carries the durable domain events (`macro.databases`) other domains
/// consume, activity among them.
#[derive(Debug, Clone)]
pub struct DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker> {
    repo: Repo,
    definitions: Defs,
    magic: Magic,
    executor: Arc<Exec>,
    events: Events,
    access: Access,
    broker: Broker,
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

/// Who a receipt says is acting, as domain events record it. Internal and
/// unauthenticated receipts have nobody to attribute the write to.
fn receipt_attribution<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Option<events::Attribution> {
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user) => Some(events::Attribution::user(user.clone())),
        EntityAccessAuth::Bot(bot) => Some(events::Attribution {
            actor: Actor::new_from_bot(bot.bot_id()),
            on_behalf_of: bot.scope().acting_user_id().cloned(),
        }),
        EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => None,
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

/// Whether a data type's cells are drawn from an explicit set of options.
fn takes_options(data_type: DataType) -> bool {
    matches!(
        data_type,
        DataType::SelectString | DataType::SelectNumber | DataType::Tag
    )
}

/// The value the properties system stores for one display label.
///
/// A numeric select stores numbers, so its labels have to parse as one;
/// letting `"soon"` through would store it as text and leave a cell SQL can
/// never satisfy.
fn option_value(data_type: DataType, label: &str) -> Result<PropertyOptionValue, DatabaseError> {
    if data_type != DataType::SelectNumber {
        return Ok(PropertyOptionValue::String(label.to_string()));
    }
    match label.parse::<f64>() {
        Ok(number) if number.is_finite() => Ok(PropertyOptionValue::Number(number)),
        _ => Err(DatabaseError::InvalidSchemaOperation(format!(
            "`{label}` is not a number; the options of a numeric select column must be numbers"
        ))),
    }
}

/// Validate option labels and turn them into stored values, dropping the ones
/// the column already has.
///
/// `existing` are the column's current labels. Re-adding one is a no-op rather
/// than an error: a caller re-sending the full set of options it wants should
/// end up with exactly that set, not a failure.
fn validate_option_labels(
    data_type: DataType,
    labels: &[String],
    existing: &[String],
) -> Result<Vec<PropertyOptionValue>, DatabaseError> {
    let mut taken: HashSet<String> = existing.iter().map(|label| option_key(label)).collect();
    let mut values = Vec::new();
    for label in labels {
        let trimmed = label.trim();
        if trimmed.is_empty() {
            return Err(DatabaseError::InvalidSchemaOperation(
                "an option label must not be empty".into(),
            ));
        }
        if trimmed.chars().count() > MAX_OPTION_LABEL_LEN {
            return Err(DatabaseError::InvalidSchemaOperation(format!(
                "an option label must be at most {MAX_OPTION_LABEL_LEN} characters"
            )));
        }
        let value = option_value(data_type, trimmed)?;
        // Compare on the label SQL will see: `2.0` and `2` are one numeric
        // option, and `Main` and `main` would compile to indistinguishable
        // `CHECK` entries.
        if taken.insert(option_key(&catalog::option_display(&value))) {
            values.push(value);
        }
    }
    Ok(values)
}

fn option_key(label: &str) -> String {
    label.trim().to_lowercase()
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

impl<Repo, Defs, Magic, Exec, Events, Access, Broker>
    DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    /// Create a databases service from its port implementations.
    pub fn new(
        repo: Repo,
        definitions: Defs,
        magic: Magic,
        executor: Exec,
        events: Events,
        access: Access,
        broker: Broker,
    ) -> Self {
        Self {
            repo,
            definitions,
            magic,
            executor: Arc::new(executor),
            events,
            access,
            broker,
        }
    }

    /// Publish one domain event. The write it describes already committed,
    /// so a broker failure is logged rather than surfaced.
    fn emit(&self, event: DatabaseMacroEvent) {
        if let Err(error) = self.broker.send_event(&event) {
            tracing::warn!(error = ?error, "failed to publish database event");
        }
    }

    /// Build catalog entries for a set of databases the viewer holds grants on.
    ///
    /// `reserved` are the SQL names bare table names may not claim — the magic
    /// tables, for anything that shares a namespace with `exec_sql`. A
    /// self-contained artefact with no magic tables in it (the SQLite
    /// snapshot) passes an empty list so its tables keep their bare names.
    async fn entries_for(
        &self,
        grants: &HashMap<DatabaseId, AccessGrant>,
        reserved: &[String],
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
        Ok(catalog::build_user_tables(
            &databases,
            &tables,
            &columns,
            &definitions,
            grants,
            reserved,
        ))
    }

    /// The magic-table names bare user-table names must not shadow.
    fn reserved_names(&self) -> Vec<String> {
        self.magic
            .schemas()
            .into_iter()
            .map(|s| s.sql_name)
            .collect()
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
        let entries = self.entries_for(&grants, &self.reserved_names()).await?;
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
            // One over the cap is enough to know the cap was broken, and stops
            // an oversized table being pulled into memory just to be refused.
            let fetched = self
                .repo
                .fetch_rows(entry.table.id, MAX_MATERIALIZED_ROWS + 1)
                .await
                .map_err(infra)?;
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
                let removed = changes.iter().any(|change| {
                    matches!(
                        change,
                        RowChange::Delete { table_id, row_id }
                            if *table_id == table && *row_id == row
                    )
                });
                if matches!(change, RowChange::Link { .. }) && removed {
                    return false;
                }
                let inserted = changes.iter().any(|change| {
                    matches!(
                        change,
                        RowChange::Insert { table_id, row_id, .. }
                            if *table_id == table && *row_id == row
                    )
                });
                inserted
                    || loaded
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
            tables: entries.into_iter().map(Self::table_detail).collect(),
        }
    }

    fn table_detail(entry: TableEntry) -> TableDetail {
        let read_sql_name = catalog::read_table_name(entry.table.id);
        let columns = entry
            .columns
            .into_iter()
            .map(|column| {
                let junction = entry
                    .junctions
                    .iter()
                    .find(|j| j.column_id == column.column.id);
                let read_junction = format!("{read_sql_name}__{}", column.sql_name);
                ColumnDetail {
                    junction_sql_name: junction.map(|j| j.schema.sql_name.clone()),
                    read_junction_sql_name: junction.and_then(|j| {
                        j.schema
                            .aliases
                            .iter()
                            .find(|name| **name == read_junction)
                            .cloned()
                    }),
                    junction_writable: junction.is_some_and(|j| j.schema.writable),
                    column: column.column,
                    sql_name: column.sql_name,
                    definition: column.definition,
                    writable: column.writable,
                }
            })
            .collect();
        TableDetail {
            sql_name: entry.schema.sql_name,
            read_sql_name,
            table: entry.table,
            columns,
        }
    }

    /// Announce a committed write: a liveness ping per table for open
    /// clients, and one durable tables-changed event per database.
    async fn publish(
        &self,
        attribution: Option<events::Attribution>,
        database_of: &HashMap<TableId, DatabaseId>,
        versions: &HashMap<TableId, TableVersion>,
    ) {
        let mut changed_by_database: HashMap<DatabaseId, Vec<TableVersionChange>> = HashMap::new();
        for (table_id, version) in versions {
            let Some(database_id) = database_of.get(table_id) else {
                continue;
            };
            changed_by_database
                .entry(*database_id)
                .or_default()
                .push(TableVersionChange {
                    table_id: *table_id,
                    version: *version,
                });
            if let Err(error) = self
                .events
                .table_changed(*database_id, *table_id, *version)
                .await
            {
                // Liveness is best-effort: the write already committed.
                tracing::warn!(error = ?error, %table_id, "failed to publish table change");
            }
        }
        for (database_id, mut tables) in changed_by_database {
            tables.sort_by_key(|change| change.table_id);
            self.emit(DatabaseMacroEvent::tables_changed(
                DatabaseTablesChangedMetadata {
                    database_id: database_id.to_string(),
                    attribution: attribution.clone(),
                    tables,
                },
            ));
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

    /// One column as the client sees it, named against the same catalog the
    /// query surface uses so its `sql_name` is the one SQL answers to.
    async fn column_detail(
        &self,
        viewer: &Viewer,
        database_id: DatabaseId,
        grant: AccessGrant,
        table_id: TableId,
        column_id: ColumnId,
    ) -> Result<ColumnDetail, DatabaseError> {
        let grants = self
            .viewer_grants(viewer, database_id, grant)
            .await
            .map_err(repo_err)?;
        let entries = self
            .entries_for(&grants, &self.reserved_names())
            .await
            .map_err(|e| DatabaseError::Repo(rootcause::Report::new(e).into_dynamic()))?;
        Self::entries_of(entries, database_id)
            .into_iter()
            .map(Self::table_detail)
            .find(|entry| entry.table.id == table_id)
            .and_then(|entry| {
                entry
                    .columns
                    .into_iter()
                    .find(|column| column.column.id == column_id)
            })
            .ok_or(DatabaseError::NotFound)
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

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> DatabasesService
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self), err)]
    async fn create_database(&self, cmd: CreateDatabase) -> Result<Database, DatabaseError> {
        let cmd = CreateDatabase {
            name: validate_name(&cmd.name)?,
            owner_id: cmd.owner_id,
        };
        let database = self
            .repo
            .create_database(&cmd, STARTER_TABLE_NAME)
            .await
            .map_err(repo_err)?;
        self.emit(DatabaseMacroEvent::created(DatabaseCreatedMetadata {
            database_id: database.id.to_string(),
            owner: cmd.owner_id,
            name: database.name.clone(),
            created_at: database.created_at,
        }));
        Ok(database)
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
        self.emit(DatabaseMacroEvent::renamed(DatabaseRenamedMetadata {
            database_id: database.id.to_string(),
            attribution: receipt_attribution(&receipt),
            name: name.clone(),
        }));
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
            .map_err(repo_err)?;
        self.emit(DatabaseMacroEvent::trashed(DatabaseTrashedMetadata {
            database_id: database.id.to_string(),
            attribution: receipt_attribution(&receipt),
        }));
        Ok(())
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
            .map_err(repo_err)?;
        self.emit(DatabaseMacroEvent::restored(DatabaseRestoredMetadata {
            database_id: database.id.to_string(),
            attribution: receipt_attribution(&receipt),
        }));
        Ok(())
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
            .map_err(repo_err)?;
        self.emit(DatabaseMacroEvent::purged(DatabasePurgedMetadata {
            database_id: database.id.to_string(),
        }));
        Ok(())
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
        let live_ids: Vec<DatabaseId> = databases.iter().map(|database| database.id).collect();
        let tables = self
            .repo
            .tables_for_databases(&live_ids)
            .await
            .map_err(repo_err)?;
        let mut tables_by_database: HashMap<DatabaseId, Vec<Table>> = HashMap::new();
        for table in tables {
            tables_by_database
                .entry(table.database_id)
                .or_default()
                .push(table);
        }
        for tables in tables_by_database.values_mut() {
            tables.sort_by(|left, right| left.position.cmp(&right.position));
        }
        Ok(databases
            .into_iter()
            .filter_map(|database| {
                let grant = *grants.get(&database.id)?;
                let tables = tables_by_database.remove(&database.id).unwrap_or_default();
                Some(ListedDatabase {
                    database,
                    grant,
                    tables,
                })
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
            .entries_for(&grants, &self.reserved_names())
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
        let table = match self
            .repo
            .create_table(&CreateTable {
                database_id: cmd.database_id,
                name: name.clone(),
            })
            .await
            .map_err(repo_err)?
        {
            TableMutationOutcome::Applied(table) => table,
            TableMutationOutcome::NotFound => return Err(DatabaseError::NotFound),
            TableMutationOutcome::Conflict => {
                return Err(DatabaseError::InvalidSchemaOperation(format!(
                    "a table named `{name}` already exists in this database"
                )));
            }
        };
        self.publish(
            receipt_attribution(&receipt),
            &HashMap::from([(table.id, table.database_id)]),
            &HashMap::from([(table.id, table.version)]),
        )
        .await;
        Ok(table)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn rename_table(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
        name: String,
        previous_name: String,
    ) -> Result<Table, DatabaseError> {
        let (_, tables) = self.database_for_edit(&receipt).await?;
        let table = tables
            .iter()
            .find(|table| table.id == table_id)
            .ok_or(DatabaseError::NotFound)?;
        let name = validate_name(&name)?;
        // A retry after a lost response is already complete.
        if table.name == name {
            return Ok(table.clone());
        }
        if tables
            .iter()
            .any(|other| other.id != table_id && same_name(&other.name, &name))
        {
            return Err(DatabaseError::InvalidSchemaOperation(format!(
                "a table named `{name}` already exists in this database"
            )));
        }
        let renamed = match self
            .repo
            .rename_table(table, &name, &previous_name)
            .await
            .map_err(repo_err)?
        {
            TableMutationOutcome::Applied(table) => table,
            TableMutationOutcome::NotFound => return Err(DatabaseError::NotFound),
            TableMutationOutcome::Conflict => return Err(DatabaseError::InvalidSchemaOperation(
                "the table name changed or is already in use. Reopen Rename table and try again"
                    .into(),
            )),
        };
        self.publish(
            receipt_attribution(&receipt),
            &HashMap::from([(table_id, renamed.database_id)]),
            &HashMap::from([(table_id, renamed.version)]),
        )
        .await;
        Ok(renamed)
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn rename_column(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        name: String,
        previous_name: String,
    ) -> Result<RenameColumnOutcome, DatabaseError> {
        self.rename_column_label(receipt, table_id, column_id, name, previous_name)
            .await
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

        if cmd.infer_type
            && (cmd.config.is_some()
                || !matches!(
                    &cmd.binding,
                    ColumnBinding::NewDefinition { data_type: DataType::String, is_multi_select: false, options, .. }
                        if options.is_empty()
                ))
        {
            return Err(DatabaseError::InvalidSchemaOperation(
                "Only a new plain text column can infer its first value's type.".into(),
            ));
        }

        // Effective display labels are unique per table (case-insensitive).
        // Renamed placements keep their original definition and SQL name.
        let existing = self
            .repo
            .columns_for_tables(&[cmd.table_id])
            .await
            .map_err(repo_err)?;
        let existing_ids: Vec<Uuid> = existing.iter().map(|c| c.property_definition_id).collect();
        let definition_names: HashMap<_, _> = self
            .definitions
            .definitions(&existing_ids)
            .await
            .map_err(repo_err)?
            .into_iter()
            .map(|d| (d.definition.id, d.definition.display_name))
            .collect();
        let existing_names: Vec<_> = existing
            .iter()
            .filter_map(|column| {
                column
                    .display_name
                    .as_ref()
                    .or_else(|| definition_names.get(&column.property_definition_id))
            })
            .collect();
        let (binding, option_values) = match cmd.binding {
            ColumnBinding::NewDefinition {
                name,
                data_type,
                is_multi_select,
                options,
            } => {
                if !options.is_empty() && !takes_options(data_type) {
                    return Err(DatabaseError::InvalidSchemaOperation(
                        "options are only valid on select, select_number, and tag columns".into(),
                    ));
                }
                // Validated before anything is written, so a bad label cannot
                // leave a half-built column behind.
                let values = validate_option_labels(data_type, &options, &[])?;
                (
                    ColumnBinding::NewDefinition {
                        name: validate_name(&name)?,
                        data_type,
                        is_multi_select,
                        options,
                    },
                    values,
                )
            }
            other => (other, Vec::new()),
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
        if !option_values.is_empty() {
            self.definitions
                .add_options(definition_id, &option_values)
                .await
                .map_err(repo_err)?;
        }
        let cmd = CreateColumn { binding, ..cmd };
        let column_id = self
            .repo
            .create_column(cmd.table_id, definition_id, &cmd)
            .await
            .map_err(repo_err)?;
        match self.repo.table_versions(&[cmd.table_id]).await {
            Ok(versions) => {
                self.publish(
                    receipt_attribution(&receipt),
                    &HashMap::from([(cmd.table_id, database.id)]),
                    &versions,
                )
                .await;
            }
            Err(error) => {
                tracing::error!(
                    error = ?error,
                    table_id = %cmd.table_id,
                    "column saved but could not read its table version for publication"
                );
            }
        }
        Ok(column_id)
    }

    #[tracing::instrument(skip(self, receipt, viewer), err)]
    async fn infer_column_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        self.settle_column_type(receipt, viewer, cmd).await
    }

    #[tracing::instrument(skip(self, receipt, viewer), err)]
    async fn change_column_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: ChangeColumnType,
    ) -> Result<ColumnSchemaOutcome, DatabaseError> {
        self.change_placement_type(receipt, viewer, cmd).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete_column(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        base_version: TableVersion,
    ) -> Result<ColumnSchemaOutcome, DatabaseError> {
        self.remove_placement(receipt, table_id, column_id, base_version)
            .await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn reorder_columns(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        table_id: TableId,
        column_ids: Vec<ColumnId>,
        base_version: TableVersion,
    ) -> Result<ColumnSchemaOutcome, DatabaseError> {
        self.order_placements(receipt, table_id, column_ids, base_version)
            .await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn add_column_options(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        cmd: AddColumnOptions,
    ) -> Result<ColumnDetail, DatabaseError> {
        let (database, tables) = self.database_for_edit(&receipt).await?;
        if !tables.iter().any(|t| t.id == cmd.table_id) {
            // The receipt covers this database only; a table elsewhere is
            // indistinguishable from a missing one.
            return Err(DatabaseError::NotFound);
        }
        let columns = self
            .repo
            .columns_for_tables(&[cmd.table_id])
            .await
            .map_err(repo_err)?;
        let column = columns
            .iter()
            .find(|c| c.id == cmd.column_id)
            .ok_or(DatabaseError::NotFound)?;
        let definition = self
            .definitions
            .definitions(&[column.property_definition_id])
            .await
            .map_err(repo_err)?
            .into_iter()
            .next()
            .ok_or(DatabaseError::NotFound)?;

        let data_type = definition.definition.data_type;
        if !takes_options(data_type) {
            return Err(DatabaseError::InvalidSchemaOperation(
                "only select, select_number, and tag columns have options".into(),
            ));
        }
        let existing: Vec<String> = definition
            .property_options
            .iter()
            .map(|option| catalog::option_display(&option.value))
            .collect();
        let values = validate_option_labels(data_type, &cmd.labels, &existing)?;

        // Every label was already there: nothing changed, so nothing is
        // written, versioned, or announced.
        if !values.is_empty() {
            self.definitions
                .add_options(definition.definition.id, &values)
                .await
                .map_err(repo_err)?;
            // Options compile into the column's CHECK constraint, so the
            // table's shape moved and cached materializations are stale.
            let version = self
                .repo
                .bump_table_version(cmd.table_id)
                .await
                .map_err(repo_err)?;
            self.publish(
                receipt_attribution(&receipt),
                &HashMap::from([(cmd.table_id, database.id)]),
                &HashMap::from([(cmd.table_id, version)]),
            )
            .await;
        }

        self.column_detail(
            &viewer,
            database.id,
            receipt_grant(&receipt, AccessGrant::Edit),
            cmd.table_id,
            cmd.column_id,
        )
        .await
    }

    #[tracing::instrument(skip(self, req), err)]
    async fn exec_sql(&self, viewer: Viewer, req: ExecRequest) -> Result<ExecOutcome, QueryError> {
        self.run_sql(viewer, req, query::QueryMode::ReadWrite).await
    }

    #[tracing::instrument(skip(self, sql), err)]
    async fn query_sql(&self, viewer: Viewer, sql: String) -> Result<ExecOutcome, QueryError> {
        self.run_sql(
            viewer,
            ExecRequest {
                sql,
                base_versions: None,
            },
            query::QueryMode::ReadOnly,
        )
        .await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn sqlite_snapshot(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
    ) -> Result<SqliteSnapshot, QueryError> {
        let database_id = receipt_database_id(&receipt)
            .map_err(|_| QueryError::Sql("database not found".to_string()))?;
        // A snapshot is a standalone SQLite file containing exactly one
        // database and no magic tables, so — unlike the query surface, which
        // must name tables against the viewer's whole catalog — its tables are
        // named against that database alone and keep their bare names.
        let grants = HashMap::from([(database_id, receipt_grant(&receipt, AccessGrant::View))]);
        let entries = Self::entries_of(self.entries_for(&grants, &[]).await?, database_id);
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
