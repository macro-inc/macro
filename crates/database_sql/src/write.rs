//! Writes as ops: a resolved statement, with the rows its read found, becomes
//! the one [`DatabaseOp`] the driver applies, and the op's result becomes the
//! statement's [`Outcome`].

use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind as OpColumnKind, ColumnResult, DatabaseOp,
    EntityKind as OpEntityKind, EntityRef, OpResult, OptionId, OptionRef, RowChange, RowChanges,
    RowId, RowsChange, RowsResult, TableId,
};
use uuid::Uuid;

use crate::catalog::{Catalog, Column, ColumnKind, RelationTarget, Table};
use crate::fold::Cell;
use crate::resolve::{
    AlterColumnTypeQuery, Assigned, InsertQuery, SelectItem, UpdateQuery, Value, column_key,
};
use crate::run::{AlteredColumn, Outcome, RunError, SentOp};

/// What was sent, so its result can be read back into an outcome.
#[derive(Debug, Clone)]
pub(crate) enum Sent {
    /// Rows inserted, updated or deleted.
    Rows,
    /// A column's type change.
    Column {
        table: TableId,
        column: Uuid,
        to: OpColumnKind,
    },
}

/// `INSERT`: every row in one op. Labels name options the column has.
pub(crate) fn insert(catalog: &Catalog, query: &InsertQuery) -> DatabaseOp {
    let table = table(catalog, query.table);
    DatabaseOp::Rows {
        table: query.table,
        change: RowsChange::Insert {
            rows: query
                .rows
                .iter()
                .map(|cells| {
                    cells
                        .iter()
                        .map(|(definition, value)| {
                            let column = column(table, *definition);
                            CellWrite {
                                column: column.placement,
                                value: cell_value(column, Some(value)),
                            }
                        })
                        .collect()
                })
                .collect(),
        },
    }
}

/// `UPDATE` of the rows its read found: the same cells for every row when
/// every value is a literal, else each row its own. `None` when the read
/// found nothing.
pub(crate) fn update(
    catalog: &Catalog,
    query: &UpdateQuery,
    found: &Outcome,
) -> Option<DatabaseOp> {
    if found.row_ids.is_empty() {
        return None;
    }
    let table = table(catalog, query.table);
    let uniform = query
        .assignments
        .iter()
        .all(|assignment| matches!(assignment.value, Assigned::Value(_)));
    let cells = |row: &[Option<Cell>]| -> Vec<CellWrite> {
        query
            .assignments
            .iter()
            .map(|assignment| {
                let target = column(table, assignment.column);
                let value = match &assignment.value {
                    Assigned::Value(value) => cell_value(target, value.as_ref()),
                    Assigned::Column(definition) => {
                        let item = query
                            .read
                            .items
                            .iter()
                            .position(|item| {
                                *item == SelectItem::Column(column_key(0, *definition))
                            })
                            .expect("the read selects every copied column");
                        copied_value(target, column(table, *definition), row[item].as_ref())
                    }
                };
                CellWrite {
                    column: target.placement,
                    value,
                }
            })
            .collect()
    };
    let changes = if uniform {
        RowChanges::Uniform {
            rows: found.row_ids.clone(),
            cells: cells(&[]),
        }
    } else {
        RowChanges::PerRow {
            rows: found
                .row_ids
                .iter()
                .zip(&found.rows)
                .map(|(row, values)| RowChange {
                    row: *row,
                    cells: cells(values),
                })
                .collect(),
        }
    };
    Some(DatabaseOp::Rows {
        table: query.table,
        change: RowsChange::Update { changes },
    })
}

/// `DELETE` of the rows its read found; `None` when it found nothing.
pub(crate) fn delete(table: TableId, found: &Outcome) -> Option<DatabaseOp> {
    (!found.row_ids.is_empty()).then(|| DatabaseOp::Rows {
        table,
        change: RowsChange::Delete {
            rows: found.row_ids.clone(),
        },
    })
}

/// `ALTER COLUMN … TYPE`.
pub(crate) fn alter(catalog: &Catalog, query: &AlterColumnTypeQuery) -> DatabaseOp {
    DatabaseOp::Column {
        table: query.table,
        column: column(table(catalog, query.table), query.column).placement,
        change: ColumnChange::ChangeType { to: query.to },
    }
}

/// The outcome the results of what was sent make.
pub(crate) fn outcome(sent: &Sent, results: &[OpResult]) -> Result<Outcome, RunError> {
    let [result] = results else {
        return Err(RunError::OpResultCount {
            received: results.len(),
        });
    };
    match (sent, result) {
        (
            Sent::Rows,
            OpResult::Rows {
                change: RowsResult::Inserted { rows },
                ..
            },
        ) => Ok(Outcome {
            inserted_row_ids: rows.clone(),
            changes_applied: u32::try_from(rows.len()).unwrap_or(u32::MAX),
            ..Outcome::default()
        }),
        (
            Sent::Rows,
            OpResult::Rows {
                change: RowsResult::Updated { affected } | RowsResult::Deleted { affected },
                ..
            },
        ) => Ok(Outcome {
            changes_applied: *affected,
            ..Outcome::default()
        }),
        (
            Sent::Column { table, column, to },
            OpResult::Column {
                change: ColumnResult::TypeChanged,
                ..
            },
        ) => Ok(Outcome {
            altered_column: Some(AlteredColumn {
                table: *table,
                column: *column,
                to: to.to_string(),
            }),
            ..Outcome::default()
        }),
        (sent, received) => Err(RunError::UnexpectedOpResult {
            sent: match sent {
                Sent::Rows => SentOp::RowWrite,
                Sent::Column { .. } => SentOp::ColumnTypeChange,
            },
            received: received.into(),
        }),
    }
}

fn table(catalog: &Catalog, id: TableId) -> &Table {
    catalog
        .tables
        .iter()
        .find(|table| table.id == id)
        .expect("the statement was resolved against this catalog")
}

fn column(table: &Table, definition: Uuid) -> &Column {
    table
        .columns
        .iter()
        .find(|column| column.id == definition)
        .expect("the statement was resolved against this catalog")
}

/// A typed literal as the cell value it writes; `None` clears the cell.
fn cell_value(column: &Column, value: Option<&Value>) -> CellValue {
    let Some(value) = value else {
        return CellValue::Clear;
    };
    match value {
        Value::Text(text) if column.kind == ColumnKind::Link => CellValue::Link(vec![text.clone()]),
        Value::Text(text) => CellValue::Text(text.clone()),
        Value::Number(number) => CellValue::Number(*number),
        Value::Bool(checked) => CellValue::Boolean(*checked),
        Value::Date(date) => CellValue::Date(*date),
        Value::Option(id) => options(column, std::slice::from_ref(id)),
        Value::Options(ids) => options(column, ids),
        Value::Entity(id) => references(column, std::slice::from_ref(id)),
        Value::Entities(ids) => references(column, ids),
    }
}

/// Another column's cell, as the value it writes into `target`; the resolver
/// allows only columns of the same kind.
fn copied_value(target: &Column, source: &Column, cell: Option<&Cell>) -> CellValue {
    let Some(cell) = cell else {
        return CellValue::Clear;
    };
    match cell {
        Cell::Text(text) if target.kind == ColumnKind::Link => {
            CellValue::Link(text.split_whitespace().map(str::to_owned).collect())
        }
        Cell::Text(text) => CellValue::Text(text.clone()),
        Cell::Number(number) => CellValue::Number(*number),
        Cell::Bool(checked) => CellValue::Boolean(*checked),
        Cell::Date(date) => CellValue::Date(*date),
        Cell::Options(ids) => options(source, ids),
        Cell::Entities(ids) => references(target, ids),
        Cell::Row(id) => references(target, &[id.to_string()]),
    }
}

/// Options by label, the way a statement names them.
fn options(column: &Column, ids: &[OptionId]) -> CellValue {
    let ColumnKind::Select {
        options: labels, ..
    } = &column.kind
    else {
        unreachable!("only select columns hold options")
    };
    CellValue::Options(
        ids.iter()
            .map(|id| {
                labels
                    .iter()
                    .find(|option| option.id == *id)
                    .map_or(OptionRef::Id(*id), |option| {
                        OptionRef::Label(option.label.clone())
                    })
            })
            .collect(),
    )
}

/// Entity references, or related rows for a relation.
fn references(column: &Column, ids: &[String]) -> CellValue {
    let ColumnKind::Entity { target, .. } = column.kind else {
        unreachable!("only entity columns hold references")
    };
    match OpEntityKind::try_from(target) {
        Ok(entity_type) => CellValue::Entities(
            ids.iter()
                .map(|id| EntityRef {
                    entity_type,
                    entity_id: id.clone(),
                })
                .collect(),
        ),
        Err(RelationTarget) => CellValue::Rows(
            ids.iter()
                .filter_map(|id| id.parse::<RowId>().ok())
                .collect(),
        ),
    }
}
