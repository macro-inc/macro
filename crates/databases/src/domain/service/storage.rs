//! Core storage uses the same planner, definitions, cells and journal as the app.

mod query;

use super::*;
use crate::domain::catalog::{ColumnEntry, StorageTable};
use crate::domain::journal::Restoration;
use crate::domain::models::{AppliedOps, WritesOutcome};
use crate::domain::ports::DatabaseStorage;
use crate::domain::storage::{DatabaseStorageService, StorageRow, StorageRows, StorageRowsQuery};
use models_databases::{ColumnChange, ColumnKind, DatabaseOp, NewColumn};

impl<R, D, C, E, A, B> DatabasesServiceImpl<R, D, C, E, A, B>
where
    R: DatabasesRepo,
    D: ColumnDefinitionStore,
    C: CellStore,
    E: TableEventPublisher,
    A: AccessDirectory,
    B: MacroEventBroker,
{
    async fn storage_entries(&self, id: DatabaseId) -> Result<Vec<StorageTable>, DatabaseError> {
        let tables = self
            .repository
            .tables_for_databases(&[id])
            .await
            .map_err(repository_error)?;
        let ids: Vec<_> = tables.iter().map(|table| table.id).collect();
        let columns = self
            .repository
            .columns_for_tables(&ids)
            .await
            .map_err(repository_error)?;
        let definition_ids: Vec<_> = columns
            .iter()
            .map(|column| column.property_definition_id)
            .collect();
        let definitions: HashMap<_, _> = self
            .definitions
            .definitions(&definition_ids)
            .await
            .map_err(repository_error)?
            .into_iter()
            .map(|definition| (definition.definition.id, definition))
            .collect();
        let views = self
            .repository
            .views_for_tables(&ids)
            .await
            .map_err(repository_error)?;
        tables
            .into_iter()
            .map(|table| {
                let columns = columns
                    .iter()
                    .filter(|column| column.table_id == table.id)
                    .map(|column| {
                        Ok(ColumnEntry {
                            column: column.clone(),
                            definition: definitions
                                .get(&column.property_definition_id)
                                .cloned()
                                .ok_or(DatabaseError::NotFound)?,
                            writable: true,
                        })
                    })
                    .collect::<Result<_, DatabaseError>>()?;
                let views = views
                    .iter()
                    .filter(|view| view.table_id == table.id)
                    .cloned()
                    .collect();
                Ok(StorageTable {
                    table,
                    columns,
                    views,
                })
            })
            .collect()
    }
}

impl<R, D, C, E, A, B> DatabaseStorageService for DatabasesServiceImpl<R, D, C, E, A, B>
where
    R: DatabasesRepo,
    D: ColumnDefinitionStore,
    C: CellStore + DatabaseStorage,
    E: TableEventPublisher,
    A: AccessDirectory,
    B: MacroEventBroker,
{
    async fn storage_tables(&self, id: DatabaseId) -> Result<Vec<TableDetail>, DatabaseError> {
        Ok(self
            .storage_entries(id)
            .await?
            .into_iter()
            .map(|entry| TableDetail {
                sql_name: catalog::sql_identifier(&entry.table.name),
                table: entry.table,
                columns: entry
                    .columns
                    .into_iter()
                    .map(|column| ColumnDetail {
                        sql_name: catalog::sql_identifier(column.name()),
                        shared_outside_database: column.shared_outside(id),
                        column: column.column,
                        definition: column.definition,
                        writable: true,
                    })
                    .collect(),
                views: entry.views,
            })
            .collect())
    }

    async fn storage_rows(
        &self,
        id: DatabaseId,
        table: TableId,
        request: StorageRowsQuery,
    ) -> Result<StorageRows, DatabaseError> {
        const PAGE_SIZE: i64 = 500;
        let entry = self
            .storage_entries(id)
            .await?
            .into_iter()
            .find(|entry| entry.table.id == table)
            .ok_or(DatabaseError::NotFound)?;
        // Scan in bounded batches, then let the shared SQL engine apply the complete
        // view before paging. Sorting one fetched page would give incorrect results.
        let mut after = None;
        let mut source = Vec::new();
        let mut values = HashMap::new();
        loop {
            let refs = self
                .cells
                .storage_row_page(table, after, PAGE_SIZE)
                .await
                .map_err(repository_error)?;
            if refs.is_empty() {
                break;
            }
            after = refs.last().map(|row| row.id);
            let ids: Vec<_> = refs.iter().map(|row| row.id).collect();
            let cells = self.cells.cells(&ids).await.map_err(repository_error)?;
            for row in refs {
                let cells = cells.get(&row.id).cloned().unwrap_or_default();
                if request
                    .row_ids
                    .as_ref()
                    .is_some_and(|ids| !ids.contains(&row.id))
                {
                    continue;
                }
                source.push(query::row(&row, &cells));
                values.insert(row.id, cells);
            }
        }
        let ordered = query::rows(&entry, source, &request)?;
        let start = match request.after {
            Some(after) => {
                ordered
                    .iter()
                    .position(|id| *id == after)
                    .ok_or(DatabaseError::VersionConflict)?
                    + 1
            }
            None => 0,
        };
        let page: Vec<_> = ordered
            .iter()
            .skip(start)
            .take(PAGE_SIZE as usize)
            .copied()
            .collect();
        let next = (start + page.len() < ordered.len()).then(|| *page.last().unwrap());
        let rows = page
            .into_iter()
            .map(|row_id| {
                let cells = values.remove(&row_id).unwrap_or_default();
                StorageRow {
                    row_id,
                    cells: entry
                        .columns
                        .iter()
                        .filter_map(|column| {
                            cells
                                .get(&column.column.property_definition_id)
                                .cloned()
                                .map(|value| (column.column.id, value))
                        })
                        .collect(),
                }
            })
            .collect();
        let version = self
            .repository
            .table_versions(&[table])
            .await
            .map_err(repository_error)?
            .get(&table)
            .copied()
            .ok_or(DatabaseError::NotFound)?;
        if version != entry.table.version {
            return Err(DatabaseError::VersionConflict);
        }
        Ok(StorageRows {
            rows,
            next,
            version,
        })
    }

    async fn apply_storage_ops(
        &self,
        id: DatabaseId,
        viewer: Viewer,
        batch: OpBatch,
    ) -> Result<AppliedOps, DatabaseError> {
        for (index, op) in batch.ops.iter().enumerate() {
            if matches!(
                op,
                DatabaseOp::Column {
                    change: ColumnChange::Create {
                        definition: NewColumn::Existing { .. },
                        ..
                    },
                    ..
                } | DatabaseOp::Column {
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            kind: ColumnKind::Relation { .. },
                            ..
                        },
                        ..
                    },
                    ..
                } | DatabaseOp::Column {
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Relation { .. }
                    },
                    ..
                }
            ) {
                return Err(DatabaseError::InvalidOp(crate::domain::models::OpRefusal {
                    op: index,
                    row: None,
                    column: None,
                    taken: None,
                    reason: "Storage consumers must authorize external bindings and relations"
                        .into(),
                }));
            }
        }
        for _ in 0..ops::MAX_PLANNING_ATTEMPTS {
            let entries = self.storage_entries(id).await?;
            let (writes, planner) = self
                .prepare_storage_batch(id, &entries, &viewer, &batch, &Restoration::default())
                .await?;
            let outcome = self
                .cells
                .apply_storage_writes(&writes)
                .await
                .map_err(repository_error)?;
            if matches!(outcome, WritesOutcome::SchemaMoved(_)) {
                continue;
            }
            return planner.finish(&entries, &batch, &writes, outcome);
        }
        Err(DatabaseError::VersionConflict)
    }
}
