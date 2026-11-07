//! Undoing one's own change: its inverse, guarded against later edits, as a
//! new journaled batch.

use std::collections::BTreeMap;

use models_databases::{DatabaseOp, RowChanges, RowsChange, ViewChange};

use super::*;
use crate::domain::journal::{self, Current, Guarded, UndoOutcome};
use crate::domain::models::ChangeId;

/// How often an undo reads again when the table moves between its read and
/// its write.
const MAX_UNDO_ATTEMPTS: usize = 3;

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
    /// Read the change, what came after it and what the table holds now,
    /// guard its inverse, and apply what is left as a batch based on the
    /// version read: a write landing in between refuses that batch, and the
    /// undo reads again, so its guards always judge the state it writes on.
    pub(super) async fn undo(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        change: ChangeId,
    ) -> Result<UndoOutcome, DatabaseError> {
        let database_id = receipt_database_id(&receipt)?;
        for _ in 0..MAX_UNDO_ATTEMPTS {
            let record = self
                .repository
                .change(database_id, change)
                .await
                .map_err(repository_error)?
                .ok_or(DatabaseError::NotFound)?;
            let grant = receipt_grant(&receipt, AccessLevel::Edit);
            let entries = self
                .entries_for(&HashMap::from([(database_id, grant)]))
                .await?;
            if !entries
                .iter()
                .any(|entry| entry.table.id == record.change.table)
            {
                return Ok(UndoOutcome::Refused {
                    reason: journal::UndoRefusal::NotUndoable,
                    by: None,
                });
            }
            let base_versions = entries
                .iter()
                .map(|entry| (entry.table.id, entry.table.version))
                .collect();
            let later = self
                .repository
                .changes_after(record.change.table, record.change.version)
                .await
                .map_err(repository_error)?;
            let schema = catalog::schema_image(&entries);
            let rows = self
                .current_rows(&schema, record.change.table, &record.change.inverse)
                .await?;
            let current = Current { schema, rows };
            let guarded = journal::guard(viewer.user_id.as_ref(), &record, &later, &current);
            let (ops, restoration, skipped) = match guarded {
                Guarded::Refused { reason, by } => {
                    return Ok(UndoOutcome::Refused { reason, by });
                }
                Guarded::Apply {
                    ops,
                    restoration,
                    skipped,
                } => (ops, restoration, skipped),
            };
            if ops.is_empty() {
                return Ok(if skipped.is_empty() {
                    UndoOutcome::Reverted {
                        changes: Vec::new(),
                    }
                } else {
                    UndoOutcome::Partial {
                        skipped,
                        changes: Vec::new(),
                    }
                });
            }
            let batch = OpBatch { ops, base_versions };
            match self
                .apply_batch(&receipt, &viewer, &batch, &restoration)
                .await
            {
                Ok(applied) => {
                    return Ok(if skipped.is_empty() {
                        UndoOutcome::Reverted {
                            changes: applied.changes,
                        }
                    } else {
                        UndoOutcome::Partial {
                            skipped,
                            changes: applied.changes,
                        }
                    });
                }
                Err(DatabaseError::VersionConflict) => continue,
                Err(DatabaseError::RowInUse) => {
                    return Ok(UndoOutcome::Refused {
                        reason: journal::UndoRefusal::RowInUse,
                        by: None,
                    });
                }
                Err(DatabaseError::OptionInUse) => {
                    return Ok(UndoOutcome::Refused {
                        reason: journal::UndoRefusal::OptionInUse,
                        by: None,
                    });
                }
                Err(DatabaseError::InvalidOp(refusal))
                    if refusal.reason.contains("is back already") || refusal.taken.is_some() =>
                {
                    return Ok(UndoOutcome::Refused {
                        reason: journal::UndoRefusal::AlreadyBack,
                        by: None,
                    });
                }
                Err(error) => return Err(error),
            }
        }
        Err(DatabaseError::VersionConflict)
    }

    /// The rows an inverse names that still exist, with their cells now, by
    /// column.
    async fn current_rows(
        &self,
        schema: &journal::SchemaImage,
        table: TableId,
        inverse: &journal::ChangeInverse,
    ) -> Result<BTreeMap<RowId, BTreeMap<ColumnId, models_databases::CellValue>>, DatabaseError>
    {
        let mut named: Vec<RowId> = inverse
            .restored_rows
            .values()
            .flatten()
            .map(|row| row.id)
            .collect();
        for op in &inverse.ops {
            match op {
                DatabaseOp::Rows {
                    change:
                        RowsChange::Update {
                            changes: RowChanges::PerRow { rows },
                        },
                    ..
                } => named.extend(rows.iter().map(|row| row.row)),
                DatabaseOp::Rows {
                    change: RowsChange::Delete { rows },
                    ..
                } => named.extend(rows.iter().copied()),
                DatabaseOp::View {
                    change: ViewChange::MoveCard { row, .. },
                    ..
                } => named.push(*row),
                _ => {}
            }
        }
        let held: Vec<RowId> = self
            .repository
            .row_refs(table)
            .await
            .map_err(repository_error)?
            .into_iter()
            .map(|row| row.id)
            .collect();
        named.retain(|row| held.contains(row));
        named.sort();
        named.dedup();
        let cells = self.cells.cells(&named).await.map_err(repository_error)?;
        Ok(named
            .into_iter()
            .map(|row| {
                let stored = cells.get(&row).cloned().unwrap_or_default();
                (row, journal::row_cells(schema, table, &stored))
            })
            .collect())
    }
}
