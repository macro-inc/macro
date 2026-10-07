//! The row ops: inserting, updating and deleting a table's rows, their cells
//! checked against the columns as earlier ops leave them.

use models_databases::views::LaneKey;
use models_databases::{RowChanges, RowsChange};

use super::{MAX_WRITTEN_ROWS, Place, Planner, refuse};
use crate::domain::catalog::StorageTable;
use crate::domain::journal::cell_value;
use crate::domain::models::{DatabaseError, Write};

impl Planner {
    pub(super) fn rows_write(
        &mut self,
        index: usize,
        entry: &StorageTable,
        change: &RowsChange,
    ) -> Result<Write, DatabaseError> {
        let table = entry.table.id;
        self.written_rows += match change {
            RowsChange::Insert { rows } => rows.len(),
            RowsChange::Update {
                changes: RowChanges::Uniform { rows, .. },
            }
            | RowsChange::Delete { rows } => rows.len(),
            RowsChange::Update {
                changes: RowChanges::PerRow { rows },
            } => rows.len(),
        };
        if self.written_rows > MAX_WRITTEN_ROWS {
            return Err(refuse(
                index,
                None,
                None,
                format!("a request writes at most {MAX_WRITTEN_ROWS} rows"),
            ));
        }
        self.written_tables.insert(table);
        match change {
            RowsChange::Insert { rows } => {
                let rows = rows
                    .iter()
                    .enumerate()
                    .map(|(row, cells)| {
                        for column in &entry.columns {
                            if !column.column.nullable
                                && !cells.iter().any(|cell| cell.column == column.column.id)
                            {
                                return Err(Place {
                                    op: index,
                                    row: Some(row),
                                    column: column.column.id,
                                }
                                .refuse(format!("\"{}\" requires a value", column.name())));
                            }
                        }
                        let cells = self.cells(entry, index, Some(row), cells)?;
                        Ok(cells
                            .into_iter()
                            .filter_map(|(definition, value)| {
                                value.map(|value| (definition, value))
                            })
                            .collect::<Vec<_>>())
                    })
                    .collect::<Result<Vec<_>, DatabaseError>>()?;
                let restored = self.restoration.rows.remove(&index).unwrap_or_default();
                if !restored.is_empty() && restored.len() != rows.len() {
                    return Err(refuse(
                        index,
                        None,
                        None,
                        "the rows to put back do not match the rows inserted",
                    ));
                }
                // Subsequent card moves must see rows restored earlier in this batch.
                for view in &entry.views {
                    if let Some(board) = self.boards.get_mut(&view.id) {
                        for (row, cells) in restored.iter().zip(&rows) {
                            let value = cells.iter().find_map(|(definition, value)| {
                                (*definition == board.grouping).then_some(value)
                            });
                            let lane = LaneKey::of_cell(value.and_then(cell_value).as_ref());
                            board.cards.insert(row.id, (lane, None));
                        }
                    }
                }
                Ok(Write::InsertRows {
                    table_id: table,
                    rows,
                    restored,
                })
            }
            RowsChange::Update {
                changes: RowChanges::Uniform { rows, cells },
            } => {
                let cells = self.cells(entry, index, None, cells)?;
                Ok(Write::UpdateRows {
                    table_id: table,
                    rows: rows.iter().map(|row| (*row, cells.clone())).collect(),
                })
            }
            RowsChange::Update {
                changes: RowChanges::PerRow { rows },
            } => Ok(Write::UpdateRows {
                table_id: table,
                rows: rows
                    .iter()
                    .enumerate()
                    .map(|(row, change)| {
                        let cells = self.cells(entry, index, Some(row), &change.cells)?;
                        Ok((change.row, cells))
                    })
                    .collect::<Result<_, DatabaseError>>()?,
            }),
            RowsChange::Delete { rows } => {
                for (row, id) in rows.iter().enumerate() {
                    if rows[..row].contains(id) {
                        return Err(refuse(
                            index,
                            Some(row),
                            None,
                            format!("row {id} is named twice"),
                        ));
                    }
                }
                Ok(Write::DeleteRows {
                    only_if_unreferenced: rows
                        .iter()
                        .any(|row| self.restoration.unreferenced_rows.contains(row)),
                    table_id: table,
                    rows: rows.clone(),
                })
            }
        }
    }
}
