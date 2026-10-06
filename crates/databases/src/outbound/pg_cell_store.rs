//! Cells as entity properties through the properties crate's adapter; a batch
//! shares one transaction across the schema, row identities, cells and
//! options.

mod core;
mod transfer;

use std::collections::HashMap;

use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use properties::domain::database_cell_writer::DatabaseCellWriter;
use properties::domain::database_definition_writer::{
    DatabaseDefinitionWriter, NewDatabaseDefinition,
};
use properties::domain::database_option_writer::{
    ColorChange, DatabaseOptionWriter, DeleteUnusedOptionOutcome,
};
use properties::domain::model::UpdatePropertyOptionOutcome;
use properties::domain::ports::PropertiesRepo;
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::journal::{Before, JournalActor, RowImage, cell_value, row_cells};
use crate::domain::models::{
    ColumnProtection, NewDefinition, OptionId, PropertyDefinitionId, RowId, TableId, TakenId,
    Write, Writes, WritesOutcome,
};
use crate::domain::ports::CellStore;
use crate::outbound::pg_databases_repo::schema::{self, Inserted, Removed};
use crate::outbound::pg_databases_repo::{PgDatabasesRepoError, journal, rows, views};

/// [`CellStore`] over the properties repository, with the pool its batches
/// open their transaction on.
#[derive(Debug, Clone)]
pub struct PgCellStore<Properties> {
    pool: PgPool,
    properties: Properties,
}

impl<Properties> PgCellStore<Properties> {
    /// Wrap the properties repository.
    pub fn new(pool: PgPool, properties: Properties) -> Self {
        Self { pool, properties }
    }
}

/// The properties-side name of a row.
fn row_entity(row: RowId) -> EntityReference {
    EntityReference {
        entity_id: row.to_string(),
        entity_type: EntityType::DatabaseRow,
        specific_message_id: None,
    }
}

/// The store's error, keeping the failing side's cause.
#[derive(Debug, thiserror::Error)]
pub enum PgCellStoreError {
    /// The properties repository failed.
    #[error("properties: {0}")]
    Properties(#[from] anyhow::Error),
    /// A statement of a batch failed; nothing of it committed.
    #[error("row batch: {0}")]
    Sqlx(#[from] sqlx::Error),
    /// The properties writer failed inside a batch; nothing of it committed.
    #[error("row batch cells: {0}")]
    Cells(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// A repository statement of a batch failed; nothing of it committed.
    #[error("row batch statement: {0}")]
    Repository(#[from] PgDatabasesRepoError),
    /// The properties side keyed a row's cells by something that is not a
    /// row id.
    #[error("row cells keyed by `{0}`, which is not a row id")]
    CorruptRowId(String),
    /// An imported table carries its request key without the fingerprint
    /// written with it.
    #[error("imported table {0} has no import fingerprint")]
    MissingImportFingerprint(TableId),
}

/// The unique index on a table's view names.
const VIEW_NAME_CONSTRAINT: &str = "database_views_table_name_key";
/// The primary key of `database_views`.
const VIEW_KEY: &str = "database_views_pkey";

/// Which constraint a view statement failed on, if it failed on one.
fn violated(error: &PgDatabasesRepoError) -> Option<&str> {
    match error {
        PgDatabasesRepoError::Sqlx(sqlx::Error::Database(database)) => database.constraint(),
        _ => None,
    }
}

/// Whether a view statement failed on the unique view name of its table.
fn name_taken(error: &PgDatabasesRepoError) -> bool {
    violated(error) == Some(VIEW_NAME_CONSTRAINT)
}

/// The row a properties-side entity id names.
fn row_of(entity_id: &str) -> Result<RowId, PgCellStoreError> {
    entity_id
        .parse()
        .map_err(|_| PgCellStoreError::CorruptRowId(entity_id.to_string()))
}

/// Preserve the batch API's missing-table outcome when its parent is absent.
fn missing_database(writes: &Writes) -> WritesOutcome {
    WritesOutcome::TableNotFound(
        writes
            .writes
            .iter()
            .flat_map(|write| write.versioned_tables().iter().copied())
            .next()
            .unwrap_or_default(),
    )
}

fn cells_error(error: impl std::error::Error + Send + Sync + 'static) -> PgCellStoreError {
    PgCellStoreError::Cells(Box::new(error))
}

impl<Properties> CellStore for PgCellStore<Properties>
where
    Properties: PropertiesRepo<Err = anyhow::Error>
        + DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>
        + DatabaseOptionWriter
        + DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    type Error = PgCellStoreError;

    #[tracing::instrument(err, skip(self, rows), fields(rows = rows.len()))]
    async fn cells(
        &self,
        rows: &[RowId],
    ) -> Result<HashMap<RowId, HashMap<PropertyDefinitionId, PropertyValue>>, Self::Error> {
        if rows.is_empty() {
            return Ok(HashMap::new());
        }
        let fetched = self
            .properties
            .get_entity_properties_batch(rows.iter().map(|row| row_entity(*row)).collect())
            .await?;
        let mut cells: HashMap<RowId, HashMap<PropertyDefinitionId, PropertyValue>> =
            HashMap::new();
        for (key, properties) in fetched {
            let row_cells = cells.entry(row_of(&key.entity_id)?).or_default();
            for property in properties {
                if let Some(value) = property.value {
                    row_cells.insert(property.property.property_definition_id, value);
                }
            }
        }
        Ok(cells)
    }

    #[tracing::instrument(err, skip(self, rows), fields(rows = rows.len()))]
    async fn column_cells(
        &self,
        rows: &[RowId],
        definition: PropertyDefinitionId,
    ) -> Result<HashMap<RowId, PropertyValue>, Self::Error> {
        if rows.is_empty() {
            return Ok(HashMap::new());
        }
        let fetched = self
            .properties
            .get_entity_properties_batch_filtered(
                rows.iter().map(|row| row_entity(*row)).collect(),
                vec![definition],
                None,
            )
            .await?;
        let mut cells = HashMap::new();
        for (key, properties) in fetched {
            let row = row_of(&key.entity_id)?;
            let value = properties
                .into_iter()
                .find(|property| property.property.property_definition_id == definition)
                .and_then(|property| property.value);
            if let Some(value) = value {
                cells.insert(row, value);
            }
        }
        Ok(cells)
    }

    #[tracing::instrument(err, skip(self, writes), fields(writes = writes.writes.len()))]
    async fn apply_writes(&self, writes: &Writes) -> Result<WritesOutcome, Self::Error> {
        // Returning before the commit drops the transaction, which rolls
        // everything back.
        let mut transaction = self.pool.begin().await?;

        if !rows::lock_live_database(&mut transaction, writes.database_id).await? {
            return Ok(missing_database(writes));
        }
        self.apply_in(transaction, writes).await
    }
}

/// What one write did inside its batch: the rows it inserted, or the
/// outcome refusing the whole batch.
enum Applied {
    Rows(Vec<RowId>),
    Refused(WritesOutcome),
}

impl<Properties> PgCellStore<Properties>
where
    Properties: PropertiesRepo<Err = anyhow::Error>
        + DatabaseCellWriter<Transaction = Transaction<'static, Postgres>>
        + DatabaseOptionWriter
        + DatabaseDefinitionWriter<Transaction = Transaction<'static, Postgres>>
        + Send
        + Sync
        + 'static,
{
    /// Commit a core storage batch; the app wrapper takes its entity lock first.
    async fn apply_in(
        &self,
        mut transaction: Transaction<'static, Postgres>,
        writes: &Writes,
    ) -> Result<WritesOutcome, PgCellStoreError> {
        // Parent locks precede table locks, as every writer takes them.
        if !schema::lock_database(
            &mut transaction,
            writes.database_id,
            writes.changes_tables(),
        )
        .await?
        {
            return Ok(missing_database(writes));
        }
        let created: Vec<TableId> = writes
            .writes
            .iter()
            .filter_map(|write| match write {
                Write::CreateTable { table_id, .. } => Some(*table_id),
                _ => None,
            })
            .collect();
        let deleted: Vec<TableId> = writes
            .writes
            .iter()
            .filter_map(|write| match write {
                Write::DeleteTable { table_id, .. } => Some(*table_id),
                _ => None,
            })
            .collect();
        let mut required: Vec<TableId> = writes
            .writes
            .iter()
            .flat_map(|write| write.versioned_tables().iter().copied())
            .chain(deleted.iter().copied())
            .chain(writes.expected_versions.iter().map(|(table, _)| *table))
            .filter(|table| !created.contains(table))
            .collect();
        required.sort();
        required.dedup();
        // A relation's target sees the relation go if it is still there; it
        // may be in another database, or gone.
        let related: Vec<TableId> = writes
            .writes
            .iter()
            .filter_map(|write| match write {
                Write::DeleteColumn {
                    related: Some((_, table)),
                    ..
                } => Some(*table),
                _ => None,
            })
            .filter(|table| !required.contains(table) && !created.contains(table))
            .collect();
        let locked: Vec<TableId> = required.iter().chain(&related).copied().collect();
        let live = schema::lock_table_versions(&mut transaction, &locked).await?;
        if let Some(gone) = required.iter().find(|table| !live.contains_key(table)) {
            return Ok(WritesOutcome::TableNotFound(*gone));
        }
        let read_versions = writes.writes.iter().filter_map(|write| match write {
            Write::ReplaceColumn {
                table_id,
                read_version: Some(version),
                ..
            } => Some((*table_id, *version)),
            _ => None,
        });
        for (table, version) in writes
            .expected_versions
            .iter()
            .copied()
            .chain(read_versions)
        {
            if live.get(&table) != Some(&version) {
                return Ok(WritesOutcome::VersionConflict(table));
            }
        }
        for (table, version) in writes.journal.read_versions() {
            if live.get(&table).is_some_and(|live| *live != version) {
                return Ok(WritesOutcome::SchemaMoved(table));
            }
        }
        let before = self.before_image(&mut transaction, writes).await?;

        let mut minted: Vec<(usize, OptionId)> = Vec::new();
        for (index, write) in writes.writes.iter().enumerate() {
            let options: &[(OptionId, _)] = match write {
                Write::AddOptions { options, .. } => options,
                Write::CreateColumn {
                    definition: Some(definition),
                    ..
                } => &definition.options,
                _ => &[],
            };
            minted.extend(options.iter().map(|(id, _)| (index, *id)));
        }
        let existing = self
            .properties
            .existing_option_ids_in(
                &mut transaction,
                &minted
                    .iter()
                    .map(|(_, id)| id.into_uuid())
                    .collect::<Vec<_>>(),
            )
            .await
            .map_err(cells_error)?;
        if let Some((write, id)) = minted
            .iter()
            .find(|(_, id)| existing.contains(id.as_uuid()))
        {
            return Ok(WritesOutcome::IdTaken {
                write: *write,
                id: TakenId::Option(*id),
            });
        }

        let mut inserted = Vec::with_capacity(writes.writes.len());
        for (index, write) in writes.writes.iter().enumerate() {
            let outcome = self
                .apply_write(&mut transaction, writes, index, write)
                .await?;
            match outcome {
                Applied::Rows(rows) => inserted.push(rows),
                Applied::Refused(outcome) => return Ok(outcome),
            }
        }

        let mut grouped: Vec<(TableId, Vec<RowId>)> = Vec::new();
        for (table, row) in &writes.related_rows {
            match grouped.iter_mut().find(|(target, _)| target == table) {
                Some((_, rows)) => rows.push(*row),
                None => grouped.push((*table, vec![*row])),
            }
        }
        for (table, named) in &grouped {
            let held = rows::hold_rows(&mut *transaction, *table, named).await?;
            if let Some(row) = named.iter().find(|row| !held.contains(row)) {
                return Ok(WritesOutcome::MissingRelatedRow(*row));
            }
        }

        let mut changed: Vec<TableId> = writes
            .writes
            .iter()
            .filter(|write| write.changes())
            .flat_map(|write| write.versioned_tables().iter().copied())
            .chain(created.iter().copied())
            .chain(
                related
                    .iter()
                    .copied()
                    .filter(|table| live.contains_key(table)),
            )
            .filter(|table| !deleted.contains(table))
            .collect();
        changed.sort();
        changed.dedup();
        let mut table_versions = HashMap::new();
        for table in changed {
            let version = rows::bump_table_version(&mut *transaction, table).await?;
            table_versions.insert(table, version);
        }
        let mut stamped: Vec<RowId> = inserted.iter().flatten().copied().collect();
        stamped.extend(writes.writes.iter().flat_map(|write| match write {
            Write::UpdateRows { rows, .. } => rows.iter().map(|(row, _)| *row).collect(),
            Write::MoveCard { row, .. } => vec![*row],
            _ => Vec::new(),
        }));
        stamped.sort();
        stamped.dedup();
        journal::stamp_rows(&mut *transaction, &stamped, writes.created_by.as_ref()).await?;
        let entries = crate::domain::journal::entries(writes, &before, &inserted, &table_versions);
        let changes = journal::record(
            &mut transaction,
            &JournalActor {
                user: Some(writes.created_by.to_string()),
                acting_bot: writes.journal.acting_bot,
            },
            &entries,
        )
        .await?;
        transaction.commit().await?;
        Ok(WritesOutcome::Applied {
            inserted,
            table_versions,
            changes,
        })
    }

    /// Apply one write of a batch inside its transaction.
    async fn apply_write(
        &self,
        transaction: &mut Transaction<'static, Postgres>,
        writes: &Writes,
        index: usize,
        write: &Write,
    ) -> Result<Applied, PgCellStoreError> {
        let refused = |outcome| Ok(Applied::Refused(outcome));
        let database_id = writes.database_id;
        // Schema planning is optimistic. Recheck protections under the same table
        // locks that serialize form registration before changing stored schema.
        let protected_operation = match write {
            Write::DeleteColumn { column_id, .. } => Some((*column_id, ColumnProtection::Delete)),
            Write::ReplaceColumn { replacement, .. } => {
                Some((replacement.column.id, ColumnProtection::ChangeType))
            }
            _ => None,
        };
        if let Some((column_id, capability)) = protected_operation {
            let blocked = sqlx::query_scalar!(
                "SELECT EXISTS(SELECT 1 FROM database_column_protections WHERE column_id = $1 AND capability = $2) AS \"blocked!\"",
                column_id.into_uuid(), capability.to_string()
            ).fetch_one(&mut **transaction).await?;
            if blocked {
                return refused(WritesOutcome::ColumnProtected {
                    write: index,
                    capability,
                });
            }
        }
        match write {
            Write::Unchanged { .. } => {}
            Write::CreateTable { table_id, name } => {
                match schema::insert_table(transaction, database_id, *table_id, name).await? {
                    Inserted::Applied => {}
                    Inserted::IdTaken => {
                        return refused(WritesOutcome::IdTaken {
                            write: index,
                            id: TakenId::Table(*table_id),
                        });
                    }
                    Inserted::Conflict => {
                        return refused(WritesOutcome::TableNameTaken { write: index });
                    }
                }
            }
            Write::RenameTable {
                table_id,
                from,
                name,
            } => {
                if !schema::rename_table(transaction, database_id, *table_id, from, name).await? {
                    return refused(WritesOutcome::TableRenamedElsewhere { write: index });
                }
            }
            Write::DeleteTable { table_id, .. } => {
                match schema::delete_table(transaction, database_id, *table_id).await? {
                    Removed::Applied => {}
                    Removed::Missing => return refused(WritesOutcome::TableNotFound(*table_id)),
                    Removed::LastTable => {
                        return refused(WritesOutcome::LastTable { write: index });
                    }
                }
            }
            Write::OrderTables { tables, positions } => {
                if !schema::order_tables(transaction, database_id, tables, positions).await? {
                    return refused(WritesOutcome::TablesChanged { write: index });
                }
            }
            Write::CreateColumn { column, definition } => {
                if let Some(definition) = definition {
                    self.create_definition(transaction, database_id, definition)
                        .await?;
                }
                match schema::insert_column(transaction, column).await? {
                    Inserted::Applied => {}
                    Inserted::IdTaken => {
                        return refused(WritesOutcome::IdTaken {
                            write: index,
                            id: TakenId::Column(column.id),
                        });
                    }
                    Inserted::Conflict => {
                        return refused(WritesOutcome::MissingColumn { write: index });
                    }
                }
            }
            Write::RenameColumn {
                table_id,
                column_id,
                from,
                name,
            } => {
                if !schema::rename_column(transaction, *table_id, *column_id, from.as_deref(), name)
                    .await?
                {
                    return refused(WritesOutcome::ColumnRenamedElsewhere { write: index });
                }
            }
            Write::DeleteColumn {
                table_id,
                column_id,
                definition_id,
                views,
                ..
            } => {
                if !schema::delete_column(transaction, *table_id, *column_id, *definition_id)
                    .await?
                {
                    return refused(WritesOutcome::MissingColumn { write: index });
                }
                if !schema::rewrite_views(transaction, views).await? {
                    return refused(WritesOutcome::MissingView { write: index });
                }
            }
            Write::OrderColumns {
                table_id,
                positions,
            } => {
                if !schema::order_columns(transaction, *table_id, positions).await? {
                    return refused(WritesOutcome::MissingColumn { write: index });
                }
            }
            Write::ReplaceColumn {
                table_id,
                definition,
                replacement,
                views,
                ..
            } => {
                if let Some(definition) = definition {
                    self.create_definition(transaction, database_id, definition)
                        .await?;
                }
                if !schema::rebind_column(transaction, *table_id, replacement).await? {
                    return refused(WritesOutcome::MissingColumn { write: index });
                }
                if !schema::rewrite_views(transaction, views).await? {
                    return refused(WritesOutcome::MissingView { write: index });
                }
                for (row, value) in &replacement.values {
                    self.properties
                        .upsert_entity_property_in(
                            transaction,
                            &row_entity(*row),
                            replacement.definition_id,
                            Some(value.clone()),
                        )
                        .await
                        .map_err(cells_error)?;
                }
            }
            Write::AddOptions {
                definition_id,
                options,
                ..
            } => {
                let values: Vec<_> = options
                    .iter()
                    .map(|(id, value)| (id.into_uuid(), value.clone()))
                    .collect();
                self.properties
                    .add_options_in(transaction, *definition_id, &values)
                    .await
                    .map_err(cells_error)?;
            }
            Write::InsertRows {
                table_id,
                rows,
                restored,
            } => {
                let minted = if restored.is_empty() {
                    rows::append_rows(
                        transaction,
                        *table_id,
                        writes.created_by.as_ref(),
                        rows.len(),
                    )
                    .await?
                } else {
                    match rows::restore_rows(
                        transaction,
                        *table_id,
                        writes.created_by.as_ref(),
                        restored,
                    )
                    .await?
                    {
                        rows::Restored::Applied(rows) => Some(rows),
                        rows::Restored::TableGone => None,
                        rows::Restored::Taken(row) => {
                            return refused(WritesOutcome::RowTaken { write: index, row });
                        }
                    }
                };
                let Some(minted) = minted else {
                    return refused(WritesOutcome::TableNotFound(*table_id));
                };
                let mut valued = Vec::new();
                for (row, cells) in minted.iter().zip(rows) {
                    for (definition, value) in cells {
                        self.properties
                            .upsert_entity_property_in(
                                transaction,
                                &row_entity(row.id),
                                *definition,
                                Some(value.clone()),
                            )
                            .await
                            .map_err(cells_error)?;
                        if !valued.contains(definition) {
                            valued.push(*definition);
                        }
                    }
                }
                rows::settle_inference(&mut **transaction, *table_id, &valued).await?;
                return Ok(Applied::Rows(
                    minted.into_iter().map(|row| row.id).collect(),
                ));
            }
            Write::UpdateRows { table_id, rows } => {
                let named: Vec<RowId> = rows.iter().map(|(row, _)| *row).collect();
                let owned = rows::lock_rows(&mut **transaction, *table_id, &named).await?;
                if let Some(row) = named.iter().find(|row| !owned.contains(row)) {
                    return refused(WritesOutcome::MissingRow {
                        write: index,
                        row: *row,
                    });
                }
                let mut valued = Vec::new();
                for (row, cells) in rows {
                    for (definition, value) in cells {
                        self.properties
                            .upsert_entity_property_in(
                                transaction,
                                &row_entity(*row),
                                *definition,
                                value.clone(),
                            )
                            .await
                            .map_err(cells_error)?;
                        if value.is_some() && !valued.contains(definition) {
                            valued.push(*definition);
                        }
                    }
                }
                rows::settle_inference(&mut **transaction, *table_id, &valued).await?;
            }
            Write::DeleteRows {
                table_id,
                rows,
                only_if_unreferenced,
            } => {
                if *only_if_unreferenced {
                    rows::lock_rows(&mut **transaction, *table_id, rows).await?;
                    if self
                        .properties
                        .database_rows_referenced_in(transaction, &journal::entity_ids(rows))
                        .await
                        .map_err(cells_error)?
                    {
                        return refused(WritesOutcome::RowInUse);
                    }
                }
                for row in rows {
                    // The row's cells go with it, by the schema's trigger.
                    if !rows::delete_row(&mut **transaction, *table_id, *row).await? {
                        return refused(WritesOutcome::MissingRow {
                            write: index,
                            row: *row,
                        });
                    }
                }
            }
            Write::UpdateOption {
                definition_id,
                option_id,
                value,
                color,
                ..
            } => {
                match self
                    .properties
                    .update_option_in(
                        transaction,
                        *definition_id,
                        option_id.into_uuid(),
                        value.clone(),
                        match color {
                            None => ColorChange::Keep,
                            Some(None) => ColorChange::Clear,
                            Some(Some(color)) => ColorChange::Set(color.clone()),
                        },
                    )
                    .await
                    .map_err(cells_error)?
                {
                    UpdatePropertyOptionOutcome::Updated(_) => {}
                    UpdatePropertyOptionOutcome::NotFound => {
                        return refused(WritesOutcome::MissingOption { write: index });
                    }
                    UpdatePropertyOptionOutcome::DuplicateValue => {
                        return refused(WritesOutcome::OptionLabelTaken { write: index });
                    }
                }
            }
            Write::DeleteOption {
                only_if_unused,
                tables,
                definition_id,
                option_id,
                views: rewritten,
                ..
            } => {
                let deleted = if *only_if_unused {
                    match self
                        .properties
                        .delete_unused_option_in(transaction, *definition_id, option_id.into_uuid())
                        .await
                        .map_err(cells_error)?
                    {
                        DeleteUnusedOptionOutcome::Deleted => true,
                        DeleteUnusedOptionOutcome::NotFound => false,
                        DeleteUnusedOptionOutcome::InUse => {
                            return refused(WritesOutcome::OptionInUse);
                        }
                    }
                } else {
                    self.properties
                        .delete_option_in(transaction, *definition_id, option_id.into_uuid())
                        .await
                        .map_err(cells_error)?
                };
                if !deleted {
                    return refused(WritesOutcome::MissingOption { write: index });
                }
                for view in rewritten {
                    if !views::update_view(&mut **transaction, view).await? {
                        return refused(WritesOutcome::MissingView { write: index });
                    }
                }
                views::clear_lane(&mut **transaction, tables, *option_id).await?;
            }
            Write::CreateView { view } => {
                match views::insert_view(&mut **transaction, view).await {
                    Ok(()) => {}
                    Err(error) if violated(&error) == Some(VIEW_KEY) => {
                        return refused(WritesOutcome::IdTaken {
                            write: index,
                            id: TakenId::View(view.id),
                        });
                    }
                    Err(error) if name_taken(&error) => {
                        return refused(WritesOutcome::ViewNameTaken { write: index });
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            Write::UpdateView { view, regrouped } => {
                match views::update_view(&mut **transaction, view).await {
                    Ok(true) => {}
                    Ok(false) => return refused(WritesOutcome::MissingView { write: index }),
                    Err(error) if name_taken(&error) => {
                        return refused(WritesOutcome::ViewNameTaken { write: index });
                    }
                    Err(error) => return Err(error.into()),
                }
                if *regrouped {
                    views::clear_positions(&mut **transaction, view.id).await?;
                }
            }
            Write::DeleteView { table_id, view_id } => {
                if !views::delete_view(&mut **transaction, *table_id, *view_id).await? {
                    return refused(WritesOutcome::MissingView { write: index });
                }
            }
            Write::OrderViews {
                table_id,
                positions,
            } => {
                if !views::order_views(&mut **transaction, *table_id, positions).await? {
                    return refused(WritesOutcome::MissingView { write: index });
                }
            }
            Write::MoveCard {
                table_id,
                view_id,
                row,
                positions,
                cell: (definition, value),
            } => {
                if rows::lock_rows(&mut **transaction, *table_id, &[*row])
                    .await?
                    .is_empty()
                {
                    return refused(WritesOutcome::MissingRow {
                        write: index,
                        row: *row,
                    });
                }
                self.properties
                    .upsert_entity_property_in(
                        transaction,
                        &row_entity(*row),
                        *definition,
                        value.clone(),
                    )
                    .await
                    .map_err(cells_error)?;
                views::place_cards(&mut **transaction, *view_id, positions).await?;
            }
        }
        Ok(Applied::Rows(Vec::new()))
    }

    /// What the batch touches, read under its locks before it writes: the
    /// rows it updates, deletes or moves, every cell of the columns it
    /// removes or retypes or takes an option out of, and the cards of the
    /// boards it moves a card on.
    async fn before_image(
        &self,
        transaction: &mut Transaction<'static, Postgres>,
        writes: &Writes,
    ) -> Result<Before, PgCellStoreError> {
        let reads = crate::domain::journal::reads(writes);
        let schema = &writes.journal.schema;
        let mut before = Before {
            schema: schema.clone(),
            ..Before::default()
        };
        for write in &writes.writes {
            if let Write::DeleteOption {
                table_id,
                definition_id,
                option_id,
                ..
            } = write
            {
                let rows = journal::table_rows(&mut **transaction, *table_id).await?;
                if self
                    .properties
                    .option_used_outside_rows_in(
                        transaction,
                        *definition_id,
                        option_id.into_uuid(),
                        &journal::entity_ids(&rows),
                    )
                    .await
                    .map_err(cells_error)?
                {
                    before.incomplete_options.insert(*option_id);
                }
            }
        }
        let places = journal::row_places(&mut **transaction, &reads.rows).await?;
        if !places.is_empty() {
            let rows: Vec<RowId> = places.iter().map(|(row, _, _)| *row).collect();
            let values = self
                .properties
                .entity_values_in(
                    transaction,
                    EntityType::DatabaseRow,
                    &journal::entity_ids(&rows),
                    None,
                )
                .await
                .map_err(cells_error)?;
            let mut values = journal::by_row(values);
            for (row, table, position) in places {
                let cells = values.remove(&row).unwrap_or_default();
                before.rows.insert(
                    row,
                    RowImage {
                        table,
                        position,
                        cells: row_cells(schema, table, &cells),
                    },
                );
            }
        }
        for (table, column, definition) in &reads.columns {
            let rows = journal::table_rows(&mut **transaction, *table).await?;
            let values = self
                .properties
                .entity_values_in(
                    transaction,
                    EntityType::DatabaseRow,
                    &journal::entity_ids(&rows),
                    Some(&[*definition]),
                )
                .await
                .map_err(cells_error)?;
            let cells = journal::by_row(values)
                .into_iter()
                .filter_map(|(row, mut values)| {
                    let value = values.remove(definition)?;
                    Some((row, cell_value(&value)?))
                })
                .collect();
            before.column_cells.insert(*column, cells);
        }
        for board in &reads.boards {
            let cards = views::view_positions(&mut **transaction, *board).await?;
            before.cards.insert(*board, cards);
        }
        Ok(before)
    }

    /// Create a definition a write needs, under the ids the service minted.
    async fn create_definition(
        &self,
        transaction: &mut Transaction<'static, Postgres>,
        database_id: crate::domain::models::DatabaseId,
        definition: &NewDefinition,
    ) -> Result<(), PgCellStoreError> {
        let options: Vec<_> = definition
            .options
            .iter()
            .map(|(id, value)| (id.into_uuid(), value.clone()))
            .collect();
        self.properties
            .create_database_definition_in(
                transaction,
                NewDatabaseDefinition {
                    id: definition.id,
                    database_id: database_id.into_uuid(),
                    name: &definition.name,
                    data_type: definition.data_type,
                    is_multi_select: definition.is_multi_select,
                    specific_entity_type: definition.specific_entity_type,
                    options: &options,
                },
            )
            .await
            .map_err(cells_error)?;
        Ok(())
    }
}
