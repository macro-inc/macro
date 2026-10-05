//! An in-memory databases service: tables of typed columns and rows of
//! cells, answering the reads forms makes and applying the ops it sends,
//! recording every batch so tests can assert exactly what was written.

use std::collections::{BTreeMap, HashMap};

use ::databases::domain::catalog::{self, PropertyType};
use ::databases::domain::journal::{RowHistoryEntry, TableChanges, UndoOutcome};
use ::databases::domain::models::{
    AppliedOps, Awareness, CardPosition, ChangeId, Column, ColumnCast, ColumnConfig,
    ColumnConversion, ColumnDetail, CreateDatabase, Database, DatabaseDetail, DatabaseError,
    InferColumnType, InferColumnTypeOutcome, ListedDatabase, OpBatch, OpRefusal, QueryDefinition,
    QueryId, SavedQuery, SavedQueryError, Table, TableDetail, TableVersion, ViewId, Viewer,
};
use ::databases::domain::ports::{DatabaseRowReads, DatabasesService};
use chrono::{TimeZone, Utc};
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, OwnerAccessLevel,
    RequiredPermission, ViewAccessLevel,
};
use models_databases::position::keys_between;
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, ColumnResult, DatabaseId, DatabaseOp,
    NewColumn, OpResult, OptionId, OptionRef, RowChanges, RowId, RowsChange, RowsResult,
    TableChange, TableId, TableResult,
};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::PropertyOwner;

use super::Shared;

/// One column of a fake table.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FakeColumn {
    pub(crate) id: ColumnId,
    pub(crate) name: String,
    pub(crate) kind: ColumnKind,
    pub(crate) options: Vec<(OptionId, String)>,
}

/// One table of a fake database.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FakeTable {
    pub(crate) id: TableId,
    pub(crate) name: String,
    pub(crate) version: i64,
    pub(crate) columns: Vec<FakeColumn>,
    pub(crate) rows: Vec<(RowId, BTreeMap<ColumnId, CellValue>)>,
}

/// One fake database.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FakeDatabase {
    pub(crate) id: DatabaseId,
    pub(crate) name: String,
    pub(crate) owner: String,
    pub(crate) trashed: bool,
    pub(crate) tables: Vec<FakeTable>,
}

/// A batch the service applied, as the fake received it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RecordedBatch {
    pub(crate) database: DatabaseId,
    /// Whether the receipt was minted for an internal caller.
    pub(crate) internal: bool,
    /// The viewer the batch was applied as.
    pub(crate) viewer: String,
    pub(crate) ops: Vec<DatabaseOp>,
}

impl FakeDatabase {
    pub(crate) fn table(&self, id: TableId) -> Option<&FakeTable> {
        self.tables.iter().find(|table| table.id == id)
    }
}

/// The databases service over the shared world.
#[derive(Clone)]
pub(crate) struct FakeDatabases(pub(crate) Shared);

fn receipt_database<Level: RequiredPermission>(
    receipt: &EntityAccessReceipt<Level>,
) -> Result<DatabaseId, DatabaseError> {
    receipt
        .entity()
        .entity_id
        .parse()
        .map_err(|_| DatabaseError::NotFound)
}

fn refusal(op: usize, row: Option<usize>, column: Option<ColumnId>, reason: &str) -> DatabaseError {
    DatabaseError::InvalidOp(OpRefusal {
        op,
        row,
        column,
        taken: None,
        reason: reason.to_string(),
    })
}

fn the_epoch() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}

/// A fake column as the real service details it, so forms reads it back
/// through the same catalog functions it uses in production.
fn column_detail(
    database: &FakeDatabase,
    table: &FakeTable,
    column: &FakeColumn,
    position: models_databases::position::Position,
) -> ColumnDetail {
    let property = PropertyType::from_column_kind(column.kind);
    let definition_id = *column.id.as_uuid();
    let config = match column.kind {
        ColumnKind::Relation { database, table } => Some(ColumnConfig::Link {
            database_id: database,
            table_id: table,
        }),
        _ => None,
    };
    ColumnDetail {
        column: Column {
            id: column.id,
            table_id: table.id,
            property_definition_id: definition_id,
            position,
            config,
            display_name: Some(column.name.clone()),
            infer_type: false,
        },
        sql_name: catalog::sql_identifier(&column.name),
        definition: PropertyDefinitionWithOptions {
            definition: PropertyDefinition {
                id: definition_id,
                owner: PropertyOwner::Database {
                    database_id: *database.id.as_uuid(),
                },
                display_name: column.name.clone(),
                data_type: property.data_type,
                is_multi_select: property.is_multi_select,
                specific_entity_type: property.specific_entity_type,
                created_at: the_epoch(),
                updated_at: the_epoch(),
                is_system: false,
                is_metadata: false,
            },
            property_options: column
                .options
                .iter()
                .enumerate()
                .map(|(order, (id, label))| PropertyOption {
                    id: *id.as_uuid(),
                    property_definition_id: definition_id,
                    display_order: i32::try_from(order).expect("few options"),
                    value: PropertyOptionValue::String(label.clone()),
                    color: Some("#4A90E2".to_string()),
                    created_at: the_epoch(),
                    updated_at: the_epoch(),
                })
                .collect(),
        },
        writable: true,
        shared_outside_database: false,
    }
}

fn detail(database: &FakeDatabase, grant: AccessLevel) -> DatabaseDetail {
    let table_positions =
        keys_between(None, None, database.tables.len()).expect("positions in order");
    DatabaseDetail {
        database: Database {
            id: database.id,
            name: database.name.clone(),
            owner_id: database.owner.clone(),
            created_at: the_epoch(),
            trashed_at: None,
        },
        grant,
        tables: database
            .tables
            .iter()
            .zip(table_positions)
            .map(|(table, position)| {
                let column_positions =
                    keys_between(None, None, table.columns.len()).expect("positions in order");
                TableDetail {
                    table: Table {
                        id: table.id,
                        database_id: database.id,
                        name: table.name.clone(),
                        position,
                        version: TableVersion(table.version),
                    },
                    sql_name: catalog::sql_table_name(&database.name, &table.name),
                    columns: table
                        .columns
                        .iter()
                        .zip(column_positions)
                        .map(|(column, position)| column_detail(database, table, column, position))
                        .collect(),
                    views: vec![],
                }
            })
            .collect(),
    }
}

/// Whether `value` fits `column` as the real cell check would decide it,
/// for the shapes tests send.
fn fits(column: &FakeColumn, value: &CellValue) -> Result<CellValue, String> {
    let single = |count: usize, multi: bool| {
        if count > 1 && !multi {
            Err(format!("\"{}\" holds one value", column.name))
        } else {
            Ok(())
        }
    };
    match (column.kind, value) {
        (_, CellValue::Clear)
        | (ColumnKind::Text, CellValue::Text(_))
        | (ColumnKind::Number, CellValue::Number(_))
        | (ColumnKind::Boolean, CellValue::Boolean(_))
        | (ColumnKind::Date, CellValue::Date(_))
        | (ColumnKind::Relation { .. }, CellValue::Rows(_)) => Ok(value.clone()),
        (ColumnKind::Link, CellValue::Link(urls)) => {
            single(urls.len(), false)?;
            Ok(value.clone())
        }
        (
            ColumnKind::Select { .. } | ColumnKind::SelectNumber { .. } | ColumnKind::Tag,
            CellValue::Options(options),
        ) => {
            let multi = match column.kind {
                ColumnKind::Select { multi } | ColumnKind::SelectNumber { multi } => multi,
                _ => true,
            };
            single(options.len(), multi)?;
            let ids = options
                .iter()
                .map(|option| {
                    column
                        .options
                        .iter()
                        .find(|(id, label)| match option {
                            OptionRef::Id(named) => named == id,
                            OptionRef::Label(named) => named.eq_ignore_ascii_case(label),
                        })
                        .map(|(id, _)| OptionRef::Id(*id))
                        .ok_or_else(|| format!("\"{}\" has no such option", column.name))
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(CellValue::Options(ids))
        }
        (ColumnKind::Entity { target, multi }, CellValue::Entities(references)) => {
            single(references.len(), multi)?;
            if references
                .iter()
                .any(|reference| reference.entity_type != target)
            {
                return Err(format!("\"{}\" points at another kind", column.name));
            }
            Ok(value.clone())
        }
        _ => Err(format!("\"{}\" does not take that value", column.name)),
    }
}

/// Apply one op to a working copy of a database.
fn apply_op(
    database: &mut FakeDatabase,
    index: usize,
    op: &DatabaseOp,
) -> Result<OpResult, DatabaseError> {
    let table_of = |database: &mut FakeDatabase, table: TableId| -> Result<usize, DatabaseError> {
        database
            .tables
            .iter()
            .position(|candidate| candidate.id == table)
            .ok_or_else(|| refusal(index, None, None, "no such table"))
    };
    match op {
        DatabaseOp::Table {
            table,
            change: TableChange::Rename { name, .. },
        } => {
            let position = table_of(database, *table)?;
            let found = &mut database.tables[position];
            found.name = name.clone();
            found.version += 1;
            Ok(OpResult::Table {
                table: *table,
                table_version: Some(TableVersion(found.version)),
                change: TableResult::Renamed,
            })
        }
        DatabaseOp::Column {
            table,
            column,
            change,
        } => {
            let position = table_of(database, *table)?;
            let found = &mut database.tables[position];
            let result = match change {
                ColumnChange::Create {
                    definition:
                        NewColumn::New {
                            name,
                            kind,
                            options,
                            ..
                        },
                    ..
                } => {
                    if found
                        .columns
                        .iter()
                        .any(|existing| existing.name.eq_ignore_ascii_case(name))
                    {
                        return Err(refusal(index, None, Some(*column), "the name is taken"));
                    }
                    found.columns.push(FakeColumn {
                        id: *column,
                        name: name.clone(),
                        kind: *kind,
                        options: options
                            .iter()
                            .map(|option| (option.id, option.label.clone()))
                            .collect(),
                    });
                    ColumnResult::Created
                }
                ColumnChange::Delete => {
                    found.columns.retain(|existing| existing.id != *column);
                    for (_, cells) in &mut found.rows {
                        cells.remove(column);
                    }
                    ColumnResult::Deleted
                }
                _ => return Err(refusal(index, None, Some(*column), "the fake cannot")),
            };
            found.version += 1;
            Ok(OpResult::Column {
                table: *table,
                column: *column,
                table_version: TableVersion(found.version),
                change: result,
            })
        }
        DatabaseOp::Rows { table, change } => {
            let position = table_of(database, *table)?;
            let found = &mut database.tables[position];
            let checked = |found: &FakeTable,
                           row: usize,
                           cells: &[CellWrite]|
             -> Result<Vec<(ColumnId, CellValue)>, DatabaseError> {
                cells
                    .iter()
                    .map(|cell| {
                        let column = found
                            .columns
                            .iter()
                            .find(|column| column.id == cell.column)
                            .ok_or_else(|| {
                                refusal(index, Some(row), Some(cell.column), "no such column")
                            })?;
                        let value = fits(column, &cell.value).map_err(|reason| {
                            refusal(index, Some(row), Some(cell.column), &reason)
                        })?;
                        Ok((cell.column, value))
                    })
                    .collect()
            };
            let result = match change {
                RowsChange::Insert { rows } => {
                    let mut inserted = Vec::new();
                    for (row_index, cells) in rows.iter().enumerate() {
                        let values = checked(found, row_index, cells)?;
                        let id = RowId::new();
                        found.rows.push((
                            id,
                            values
                                .into_iter()
                                .filter(|(_, value)| *value != CellValue::Clear)
                                .collect(),
                        ));
                        inserted.push(id);
                    }
                    RowsResult::Inserted { rows: inserted }
                }
                RowsChange::Update {
                    changes: RowChanges::PerRow { rows },
                } => {
                    for (row_index, change) in rows.iter().enumerate() {
                        let values = checked(found, row_index, &change.cells)?;
                        let (_, cells) = found
                            .rows
                            .iter_mut()
                            .find(|(id, _)| *id == change.row)
                            .ok_or_else(|| {
                                refusal(index, Some(row_index), None, "no such row in this table")
                            })?;
                        for (column, value) in values {
                            if value == CellValue::Clear {
                                cells.remove(&column);
                            } else {
                                cells.insert(column, value);
                            }
                        }
                    }
                    RowsResult::Updated {
                        affected: u32::try_from(rows.len()).expect("few rows"),
                    }
                }
                RowsChange::Delete { rows } => {
                    found.rows.retain(|(id, _)| !rows.contains(id));
                    RowsResult::Deleted {
                        affected: u32::try_from(rows.len()).expect("few rows"),
                    }
                }
                RowsChange::Update { .. } => {
                    return Err(refusal(index, None, None, "the fake cannot"));
                }
            };
            found.version += 1;
            Ok(OpResult::Rows {
                table: *table,
                table_version: TableVersion(found.version),
                change: result,
            })
        }
        DatabaseOp::Table { .. } | DatabaseOp::View { .. } | DatabaseOp::ReorderTables { .. } => {
            Err(refusal(index, None, None, "the fake cannot"))
        }
    }
}

impl FakeDatabases {
    /// The live table the receipt's database holds, read for a check.
    fn with_table<Level: RequiredPermission, Answer>(
        &self,
        receipt: &EntityAccessReceipt<Level>,
        table_id: TableId,
        read: impl FnOnce(&FakeTable) -> Answer,
    ) -> Result<Answer, DatabaseError> {
        let database_id = receipt_database(receipt)?;
        let world = self.0.lock().unwrap();
        let database = world
            .databases
            .iter()
            .find(|database| database.id == database_id && !database.trashed)
            .ok_or(DatabaseError::NotFound)?;
        let table = database.table(table_id).ok_or(DatabaseError::NotFound)?;
        Ok(read(table))
    }
}

impl DatabasesService for FakeDatabases {
    async fn create_database(&self, command: CreateDatabase) -> Result<Database, DatabaseError> {
        let id = DatabaseId::new();
        let mut world = self.0.lock().unwrap();
        world.databases.push(FakeDatabase {
            id,
            name: command.name.clone(),
            owner: command.owner_id.to_string(),
            trashed: false,
            tables: vec![FakeTable {
                id: TableId::new(),
                name: "Table 1".to_string(),
                version: 1,
                columns: vec![FakeColumn {
                    id: ColumnId::new(),
                    name: "Name".to_string(),
                    kind: ColumnKind::Text,
                    options: vec![],
                }],
                rows: vec![],
            }],
        });
        world
            .created_databases
            .push((command.name.clone(), command.owner_id.to_string()));
        Ok(Database {
            id,
            name: command.name,
            owner_id: command.owner_id.to_string(),
            created_at: the_epoch(),
            trashed_at: None,
        })
    }

    async fn list_databases(&self, _viewer: Viewer) -> Result<Vec<ListedDatabase>, DatabaseError> {
        unimplemented!("forms never lists databases")
    }

    async fn database_details(
        &self,
        _viewer: Viewer,
    ) -> Result<Vec<DatabaseDetail>, DatabaseError> {
        unimplemented!("forms never lists databases")
    }

    async fn get_database(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<DatabaseDetail, DatabaseError> {
        let database_id = receipt_database(&receipt)?;
        let grant = match receipt.entity_permission() {
            entity_access::domain::models::EntityPermission::AccessLevel { access_level } => {
                *access_level
            }
            _ => AccessLevel::View,
        };
        let world = self.0.lock().unwrap();
        world
            .databases
            .iter()
            .find(|database| database.id == database_id && !database.trashed)
            .map(|database| detail(database, grant))
            .ok_or(DatabaseError::NotFound)
    }

    async fn rename_database(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _name: String,
    ) -> Result<Database, DatabaseError> {
        unimplemented!("a form never renames its database")
    }

    async fn trash_database(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("a form never trashes its database")
    }

    async fn restore_database(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        unimplemented!("a form never restores its database")
    }

    async fn delete_database_permanently(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), DatabaseError> {
        let database_id = receipt_database(&receipt)?;
        let mut world = self.0.lock().unwrap();
        world
            .databases
            .retain(|database| database.id != database_id);
        world.purged_databases.push(database_id);
        Ok(())
    }

    async fn infer_column_type(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _command: InferColumnType,
    ) -> Result<InferColumnTypeOutcome, DatabaseError> {
        unimplemented!("forms never infers a column type")
    }

    async fn column_casts(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: TableId,
        _column_id: ColumnId,
    ) -> Result<Vec<ColumnCast>, DatabaseError> {
        unimplemented!("forms never previews casts")
    }

    async fn column_conversion(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: TableId,
        _column_id: ColumnId,
        _to: ColumnKind,
    ) -> Result<ColumnConversion, DatabaseError> {
        unimplemented!("forms never converts a column")
    }

    async fn apply_ops(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<Vec<OpResult>, DatabaseError> {
        let database_id = receipt_database(&receipt)?;
        let mut world = self.0.lock().unwrap();
        world.batches.push(RecordedBatch {
            database: database_id,
            internal: matches!(receipt.auth(), EntityAccessAuth::Internal),
            viewer: viewer.user_id.to_string(),
            ops: batch.ops.clone(),
        });
        if let Some(refused) = world.refuse_next_batch.take() {
            return Err(refused);
        }
        if let Some((form, respondent)) = world.competing_submission.take() {
            let at = world.now;
            world.ledger.push(super::LedgerEntry {
                response: crate::domain::models::FormResponse {
                    id: crate::domain::models::FormResponseId::new(),
                    form_id: form,
                    status: crate::domain::models::ResponseStatus::Submitted,
                    stopped_at_section: None,
                    row: Some(RowId::new()),
                    submitted_at: at,
                    updated_at: at,
                },
                respondent: Some(respondent),
            });
        }
        let position = world
            .databases
            .iter()
            .position(|database| database.id == database_id && !database.trashed)
            .ok_or(DatabaseError::NotFound)?;
        let mut working = world.databases[position].clone();
        let results = batch
            .ops
            .iter()
            .enumerate()
            .map(|(index, op)| apply_op(&mut working, index, op))
            .collect::<Result<Vec<_>, _>>()?;
        world.databases[position] = working;
        Ok(results)
    }

    async fn apply_ops_with_changes(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: Viewer,
        _batch: OpBatch,
    ) -> Result<AppliedOps, DatabaseError> {
        unimplemented!("forms applies ops without journal changes")
    }

    async fn undo_change(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _viewer: Viewer,
        _change: ChangeId,
    ) -> Result<UndoOutcome, DatabaseError> {
        unimplemented!("forms never undoes a change")
    }

    async fn view_positions(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _view_id: ViewId,
    ) -> Result<Vec<CardPosition>, DatabaseError> {
        unimplemented!("forms never reads a board")
    }

    async fn row_history(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: TableId,
        _row_id: RowId,
    ) -> Result<Vec<RowHistoryEntry>, DatabaseError> {
        unimplemented!("forms never reads row history")
    }

    async fn table_changes(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _table_id: TableId,
        _since: TableVersion,
    ) -> Result<TableChanges, DatabaseError> {
        unimplemented!("forms never reads table changes")
    }

    async fn share_awareness(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _viewer: Viewer,
        _state: Awareness,
    ) -> Result<(), DatabaseError> {
        unimplemented!("forms relays no awareness")
    }

    async fn save_query(
        &self,
        _viewer: Viewer,
        _database_id: Option<DatabaseId>,
        _definition: QueryDefinition,
    ) -> Result<SavedQuery, SavedQueryError> {
        unimplemented!("forms saves no queries")
    }

    async fn get_query(
        &self,
        _viewer: Viewer,
        _id: QueryId,
    ) -> Result<SavedQuery, SavedQueryError> {
        unimplemented!("forms reads no queries")
    }
}

impl DatabaseRowReads for FakeDatabases {
    async fn cells_of_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        rows: &[RowId],
    ) -> Result<HashMap<RowId, Vec<CellWrite>>, DatabaseError> {
        self.with_table(&receipt, table_id, |table| {
            table
                .rows
                .iter()
                .filter(|(id, _)| rows.contains(id))
                .map(|(id, cells)| {
                    let writes = table
                        .columns
                        .iter()
                        .filter_map(|column| {
                            cells.get(&column.id).map(|value| CellWrite {
                                column: column.id,
                                value: value.clone(),
                            })
                        })
                        .collect();
                    (*id, writes)
                })
                .collect()
        })
    }

    async fn column_cells(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
    ) -> Result<HashMap<RowId, CellValue>, DatabaseError> {
        self.with_table(&receipt, table_id, |table| {
            if !table.columns.iter().any(|column| column.id == column_id) {
                return Err(DatabaseError::NotFound);
            }
            Ok(table
                .rows
                .iter()
                .filter_map(|(id, cells)| cells.get(&column_id).map(|value| (*id, value.clone())))
                .collect())
        })?
    }

    async fn row_count(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
    ) -> Result<u64, DatabaseError> {
        self.with_table(&receipt, table_id, |table| {
            u64::try_from(table.rows.len()).expect("few rows")
        })
    }
}
