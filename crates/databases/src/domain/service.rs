//! The databases service: all authorization policy beyond receipt minting,
//! and every use case's orchestration, over its ports.

mod casts;
mod column_types;
mod infer_column_type;
mod ops;
mod reads;
mod saved_queries;
mod sharing;
#[cfg(test)]
mod test;
mod transfer;
mod undo;
mod views;

use std::collections::{HashMap, HashSet};

use activity::Actor;
use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
    OwnerAccessLevel, RequiredPermission, ViewAccessLevel,
};
use macro_event_broker::MacroEventBroker;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::DataType;
use uuid::Uuid;

use crate::domain::catalog::{self, TableEntry, takes_options};
use crate::domain::events::{
    self, DatabaseCreatedMetadata, DatabaseMacroEvent, DatabasePurgedMetadata,
    DatabaseRenamedMetadata, DatabaseRestoredMetadata, DatabaseTablesChangedMetadata,
    DatabaseTrashedMetadata, TableVersionChange,
};
use crate::domain::models::{
    Awareness, CardPosition, ColumnCast, ColumnConversion, ColumnDetail, ColumnId, CreateDatabase,
    Database, DatabaseDetail, DatabaseError, DatabaseId, FirstTable, InferColumnType,
    InferColumnTypeOutcome, ListedDatabase, OpBatch, OptionId, PropertyDefinitionId,
    QueryDefinition, QueryId, RowId, RowRef, SavedQuery, SavedQueryError, SchemaError,
    SharingError, Table, TableDetail, TableId, TableVersion, ViewId, Viewer,
};
use crate::domain::ports::{
    AccessDirectory, CellStore, ColumnDefinitionStore, DatabasesRepo, DatabasesService,
    TableEventPublisher,
};

/// The table every new database starts with.
const FIRST_TABLE: FirstTable = FirstTable {
    name: "Table 1",
    title_column: "Name",
};
/// Longest accepted database/table/column name.
const MAX_NAME_LEN: usize = 200;
/// Longest accepted select-option label.
const MAX_OPTION_LABEL_LEN: usize = 200;
/// Most rows a schema operation converts in one go.
const MAX_CONVERTED_ROWS: usize = 200_000;

/// Concrete databases service backed by its ports.
///
/// `Events` is the best-effort liveness fan-out to open clients; `Broker`
/// carries the durable domain events (`macro.databases`) other domains
/// consume, activity among them.
#[derive(Debug, Clone)]
pub struct DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker> {
    repository: Repository,
    definitions: Definitions,
    cells: Cells,
    events: Events,
    access: Access,
    broker: Broker,
}

fn repository_error<E: std::error::Error + Send + Sync + 'static>(e: E) -> DatabaseError {
    DatabaseError::Repo(rootcause::Report::new(e).into_dynamic())
}

fn receipt_database_id<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> Result<DatabaseId, DatabaseError> {
    receipt
        .entity()
        .entity_id
        .parse()
        .map_err(|_| DatabaseError::NotFound)
}

/// The grant a receipt proves. Receipts minted for internal callers carry no
/// level; the extractor already enforced the route's requirement, so they
/// get exactly `floor`.
fn receipt_grant<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    floor: AccessLevel,
) -> AccessLevel {
    match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
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

/// Who a receipt says is acting, as the change journal records it.
fn receipt_journal_actor<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
) -> crate::domain::journal::JournalActor {
    use crate::domain::journal::JournalActor;
    match receipt.auth() {
        EntityAccessAuth::Authenticated(user) => JournalActor {
            user: Some(user.to_string()),
            acting_bot: None,
        },
        EntityAccessAuth::Bot(bot) => JournalActor {
            user: bot.scope().acting_user_id().map(ToString::to_string),
            acting_bot: Some(bot.bot_id()),
        },
        EntityAccessAuth::Unauthenticated | EntityAccessAuth::Internal => JournalActor {
            user: None,
            acting_bot: None,
        },
    }
}

fn validate_name(name: &str) -> Result<String, DatabaseError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(DatabaseError::from(SchemaError::EmptyName));
    }
    if trimmed.chars().count() > MAX_NAME_LEN {
        return Err(SchemaError::NameTooLong { max: MAX_NAME_LEN }.into());
    }
    Ok(trimmed.to_string())
}

/// What names are compared on: trimmed and case-folded as the SQL engine
/// matches them, so two names a statement cannot tell apart never coexist.
fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn same_name(left: &str, right: &str) -> bool {
    name_key(left) == name_key(right)
}

impl TableDetail {
    /// The table's view going by `name`, compared as every name is.
    pub fn view_named(&self, name: &str) -> Option<&crate::domain::models::DatabaseView> {
        self.views.iter().find(|view| same_name(&view.name, name))
    }
}

/// What option labels are compared on: their name key, or for a numeric
/// select the number as its label shows it, so `2.0` names the option `2`.
fn option_label_key(data_type: DataType, label: &str) -> String {
    match label.trim().parse::<f64>() {
        Ok(number) if data_type == DataType::SelectNumber && number.is_finite() => {
            models_databases::cast::number_label(number)
        }
        _ => name_key(label),
    }
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
        _ => Err(SchemaError::OptionNotNumber {
            label: label.to_string(),
        }
        .into()),
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
    let mut taken: HashSet<String> = existing
        .iter()
        .map(|label| option_label_key(data_type, label))
        .collect();
    let mut values = Vec::new();
    for label in labels {
        let trimmed = label.trim();
        if trimmed.is_empty() {
            return Err(DatabaseError::from(SchemaError::EmptyOptionLabel));
        }
        if trimmed.chars().count() > MAX_OPTION_LABEL_LEN {
            return Err(SchemaError::OptionLabelTooLong {
                max: MAX_OPTION_LABEL_LEN,
            }
            .into());
        }
        let value = option_value(data_type, trimmed)?;
        if taken.insert(option_label_key(data_type, trimmed)) {
            values.push(value);
        }
    }
    Ok(values)
}

impl<Repository, Definitions, Cells, Events, Access, Broker>
    DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    /// Create a databases service from its port implementations.
    pub fn new(
        repository: Repository,
        definitions: Definitions,
        cells: Cells,
        events: Events,
        access: Access,
        broker: Broker,
    ) -> Self {
        Self {
            repository,
            definitions,
            cells,
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

    /// Remove a definition this call created and nothing binds; a failure
    /// leaves it unbound, which is logged.
    async fn delete_unused_definition(&self, id: PropertyDefinitionId) {
        if let Err(error) = self.definitions.delete_unused_definition(id).await {
            tracing::warn!(error = ?error, %id, "failed to clean up unused column definition");
        }
    }

    /// Build catalog entries for a set of databases the viewer holds grants on.
    pub(super) async fn entries_for(
        &self,
        grants: &HashMap<DatabaseId, AccessLevel>,
    ) -> Result<Vec<TableEntry>, DatabaseError> {
        let database_ids: Vec<DatabaseId> = grants.keys().copied().collect();
        let mut databases = self
            .repository
            .databases_by_ids(&database_ids)
            .await
            .map_err(repository_error)?;
        databases.retain(|database| database.trashed_at.is_none());
        let live_ids: Vec<DatabaseId> = databases.iter().map(|database| database.id).collect();
        let tables = self
            .repository
            .tables_for_databases(&live_ids)
            .await
            .map_err(repository_error)?;
        let table_ids: Vec<TableId> = tables.iter().map(|table| table.id).collect();
        let columns = self
            .repository
            .columns_for_tables(&table_ids)
            .await
            .map_err(repository_error)?;
        let definition_ids: Vec<Uuid> = columns
            .iter()
            .map(|column| column.property_definition_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let definitions = self
            .definitions
            .definitions(&definition_ids)
            .await
            .map_err(repository_error)?
            .into_iter()
            .map(|definition| (definition.definition.id, definition))
            .collect();
        let views = self
            .repository
            .views_for_tables(&table_ids)
            .await
            .map_err(repository_error)?;
        Ok(catalog::build_entries(
            &databases,
            &tables,
            &columns,
            &definitions,
            &views,
            grants,
        ))
    }

    /// The viewer's grant on one live database; `None` when they hold none or
    /// it is trashed, which callers treat as missing.
    pub(super) async fn live_database_grant(
        &self,
        viewer: &Viewer,
        database_id: DatabaseId,
    ) -> Result<Option<AccessLevel>, rootcause::Report> {
        let grant = self
            .access
            .database_access(viewer, database_id)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        let Some(grant) = grant else {
            return Ok(None);
        };
        let live = self
            .repository
            .databases_by_ids(&[database_id])
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?
            .iter()
            .any(|database| database.trashed_at.is_none());
        Ok(live.then_some(grant))
    }

    fn detail(database: Database, grant: AccessLevel, entries: Vec<TableEntry>) -> DatabaseDetail {
        DatabaseDetail {
            database,
            grant,
            tables: entries.into_iter().map(Self::table_detail).collect(),
        }
    }

    fn table_detail(entry: TableEntry) -> TableDetail {
        let database_id = entry.database.id;
        let columns = entry
            .columns
            .into_iter()
            .map(|column| ColumnDetail {
                sql_name: catalog::sql_identifier(column.name()),
                shared_outside_database: column.shared_outside(database_id),
                column: column.column,
                definition: column.definition,
                writable: column.writable,
            })
            .collect();
        TableDetail {
            sql_name: catalog::sql_table_name(&entry.database.name, &entry.table.name),
            table: entry.table,
            columns,
            views: entry.views,
        }
    }

    /// Announce a committed write: a liveness ping per table for open
    /// clients, and one durable tables-changed event per database.
    async fn publish(
        &self,
        attribution: Option<events::Attribution>,
        changes: &[(DatabaseId, TableId, TableVersion)],
    ) {
        let mut changed_by_database: HashMap<DatabaseId, Vec<TableVersionChange>> = HashMap::new();
        for (database_id, table_id, version) in changes {
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
                    database_id,
                    attribution: attribution.clone(),
                    tables,
                },
            ));
        }
    }

    async fn database_for_edit(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<(Database, Vec<Table>), DatabaseError> {
        let database_id = receipt_database_id(receipt)?;
        let (database, tables) = self
            .repository
            .get_database(database_id)
            .await
            .map_err(repository_error)?
            .ok_or(DatabaseError::NotFound)?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        Ok((database, tables))
    }

    /// One column as the client sees it.
    async fn column_detail(
        &self,
        database_id: DatabaseId,
        grant: AccessLevel,
        table_id: TableId,
        column_id: ColumnId,
    ) -> Result<ColumnDetail, DatabaseError> {
        self.entries_for(&HashMap::from([(database_id, grant)]))
            .await?
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
            .repository
            .get_database(database_id)
            .await
            .map_err(repository_error)?
            .ok_or(DatabaseError::NotFound)?;
        Ok(database)
    }

    /// A table's rows with their cells, in position order.
    async fn rows_with_cells(
        &self,
        table_id: TableId,
    ) -> Result<Vec<(RowRef, HashMap<PropertyDefinitionId, PropertyValue>)>, DatabaseError> {
        let refs = self
            .repository
            .row_refs(table_id)
            .await
            .map_err(repository_error)?;
        let ids: Vec<RowId> = refs.iter().map(|row| row.id).collect();
        let mut cells = self.cells.cells(&ids).await.map_err(repository_error)?;
        Ok(refs
            .into_iter()
            .map(|row| {
                let row_cells = cells.remove(&row.id).unwrap_or_default();
                (row, row_cells)
            })
            .collect())
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabasesService
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self), err)]
    async fn create_database(&self, command: CreateDatabase) -> Result<Database, DatabaseError> {
        let command = CreateDatabase {
            name: validate_name(&command.name)?,
            ..command
        };
        let database = self
            .repository
            .create_database(&command, FIRST_TABLE)
            .await
            .map_err(repository_error)?;
        self.emit(DatabaseMacroEvent::created(DatabaseCreatedMetadata {
            database_id: database.id,
            owner: command.owner_id.clone(),
            name: database.name.clone(),
            created_at: database.created_at,
            attribution: events::Attribution::acting(command.owner_id, command.acting_bot),
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
        if !self
            .repository
            .rename_database(database.id, &name)
            .await
            .map_err(repository_error)?
        {
            return Err(DatabaseError::NotFound);
        }
        self.emit(DatabaseMacroEvent::renamed(DatabaseRenamedMetadata {
            database_id: database.id,
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
        if !self
            .repository
            .trash_database(database.id, Utc::now())
            .await
            .map_err(repository_error)?
        {
            return Err(DatabaseError::NotFound);
        }
        self.emit(DatabaseMacroEvent::trashed(DatabaseTrashedMetadata {
            database_id: database.id,
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
        if !self
            .repository
            .restore_database(database.id)
            .await
            .map_err(repository_error)?
        {
            return Err(DatabaseError::NotFound);
        }
        self.emit(DatabaseMacroEvent::restored(DatabaseRestoredMetadata {
            database_id: database.id,
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
        self.repository
            .delete_database(database.id)
            .await
            .map_err(repository_error)?;
        self.emit(DatabaseMacroEvent::purged(DatabasePurgedMetadata {
            database_id: database.id,
        }));
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_databases(&self, viewer: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        let grants: HashMap<DatabaseId, AccessLevel> = self
            .access
            .accessible_databases(&viewer)
            .await
            .map_err(repository_error)?
            .into_iter()
            .collect();
        let ids: Vec<DatabaseId> = grants.keys().copied().collect();
        let mut databases = self
            .repository
            .databases_by_ids(&ids)
            .await
            .map_err(repository_error)?;
        databases.retain(|database| database.trashed_at.is_none());
        databases.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        let live_ids: Vec<DatabaseId> = databases.iter().map(|database| database.id).collect();
        let tables = self
            .repository
            .tables_for_databases(&live_ids)
            .await
            .map_err(repository_error)?;
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

    #[tracing::instrument(skip(self), err)]
    async fn database_details(&self, viewer: Viewer) -> Result<Vec<DatabaseDetail>, DatabaseError> {
        let grants: HashMap<DatabaseId, AccessLevel> = self
            .access
            .accessible_databases(&viewer)
            .await
            .map_err(repository_error)?
            .into_iter()
            .collect();
        let mut entries_by_database: HashMap<DatabaseId, Vec<TableEntry>> = HashMap::new();
        let mut databases: Vec<Database> = Vec::new();
        for entry in self.entries_for(&grants).await? {
            if !entries_by_database.contains_key(&entry.database.id) {
                databases.push(entry.database.clone());
            }
            entries_by_database
                .entry(entry.database.id)
                .or_default()
                .push(entry);
        }
        databases.sort_by(|left, right| left.created_at.cmp(&right.created_at));
        Ok(databases
            .into_iter()
            .filter_map(|database| {
                let grant = *grants.get(&database.id)?;
                let mut entries = entries_by_database.remove(&database.id)?;
                entries.sort_by(|left, right| left.table.position.cmp(&right.table.position));
                Some(Self::detail(database, grant, entries))
            })
            .collect())
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn get_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DatabaseDetail, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let grant = receipt_grant(&receipt, AccessLevel::View);
        let (database, _tables) = self
            .repository
            .get_database(database_id)
            .await
            .map_err(repository_error)?
            .ok_or(DatabaseError::NotFound)?;
        if database.trashed_at.is_some() {
            return Err(DatabaseError::NotFound);
        }
        let entries = self
            .entries_for(&HashMap::from([(database_id, grant)]))
            .await?;
        Ok(Self::detail(database, grant, entries))
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn infer_column_type(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        command: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        self.settle_column_type(receipt, command).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn column_casts(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
    ) -> Result<Vec<ColumnCast>, DatabaseError> {
        self.preview_casts(receipt, table_id, column_id).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn column_conversion(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
        to: models_databases::ColumnKind,
    ) -> Result<ColumnConversion, DatabaseError> {
        self.convert_values(receipt, table_id, column_id, to).await
    }

    #[tracing::instrument(skip(self, receipt, viewer, batch), fields(ops = batch.ops.len()), err)]
    async fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<Vec<models_databases::OpResult>, DatabaseError> {
        self.apply_database_ops(receipt, viewer, batch).await
    }

    #[tracing::instrument(skip(self, receipt, viewer, batch), err)]
    async fn apply_ops_with_changes(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<crate::domain::models::AppliedOps, DatabaseError> {
        self.apply_batch(
            &receipt,
            &viewer,
            &batch,
            &crate::domain::journal::Restoration::default(),
        )
        .await
    }

    #[tracing::instrument(skip(self, receipt, viewer), err)]
    async fn undo_change(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        change: crate::domain::models::ChangeId,
    ) -> Result<crate::domain::journal::UndoOutcome, DatabaseError> {
        self.undo(receipt, viewer, change).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn view_positions(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        view_id: ViewId,
    ) -> Result<Vec<CardPosition>, DatabaseError> {
        self.board_positions(receipt, view_id).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn row_history(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        row_id: RowId,
    ) -> Result<Vec<crate::domain::journal::RowHistoryEntry>, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let changes = self
            .repository
            .row_history(database_id, table_id, row_id)
            .await
            .map_err(repository_error)?;
        Ok(crate::domain::journal::row_history(row_id, changes))
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn table_changes(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        since: TableVersion,
    ) -> Result<crate::domain::journal::TableChanges, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        let held = self
            .repository
            .get_database(database_id)
            .await
            .map_err(repository_error)?
            .filter(|(database, tables)| {
                database.trashed_at.is_none() && tables.iter().any(|table| table.id == table_id)
            });
        if held.is_none() {
            return Err(DatabaseError::NotFound);
        }
        let touches = self
            .repository
            .touches_after(table_id, since)
            .await
            .map_err(repository_error)?;
        Ok(crate::domain::journal::table_changes(since, &touches))
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn share_awareness(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        viewer: Viewer,
        state: Awareness,
    ) -> Result<(), DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        self.events
            .awareness(database_id, &viewer.user_id, &state)
            .await
            .map_err(repository_error)
    }

    #[tracing::instrument(skip(self, definition), err)]
    async fn save_query(
        &self,
        viewer: Viewer,
        database_id: Option<DatabaseId>,
        definition: QueryDefinition,
    ) -> Result<SavedQuery, SavedQueryError> {
        self.store_query(viewer, database_id, definition).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_query(&self, viewer: Viewer, id: QueryId) -> Result<SavedQuery, SavedQueryError> {
        self.readable_query(&viewer, id).await
    }
}
