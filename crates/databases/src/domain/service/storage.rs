//! Core storage uses the same planner, definitions, cells and journal as the app.

mod query;

use super::*;
use crate::domain::catalog::{ColumnEntry, StorageTable};
use crate::domain::journal::Restoration;
use crate::domain::models::{AppliedOps, WritesOutcome};
use crate::domain::ports::DatabaseStorage;
use crate::domain::storage::{
    DatabaseStorageService, StorageRow, StorageRows, StorageRowsQuery, StorageRowsRead,
    StorageTableRows,
};
use models_databases::{ColumnChange, ColumnKind, DatabaseOp, NewColumn};

/// A column as storage consumers see it, in the resource `database`.
fn column_detail(column: ColumnEntry, database: DatabaseId) -> ColumnDetail {
    ColumnDetail {
        sql_name: catalog::sql_identifier(column.name()),
        shared_outside_database: column.shared_outside(database),
        column: column.column,
        definition: column.definition,
        writable: true,
    }
}

/// A row's cells keyed by the column placing each definition.
fn storage_row(
    row_id: RowId,
    cells: &HashMap<PropertyDefinitionId, PropertyValue>,
    columns: &[ColumnEntry],
) -> StorageRow {
    StorageRow {
        row_id,
        cells: columns
            .iter()
            .filter_map(|column| {
                cells
                    .get(&column.column.property_definition_id)
                    .cloned()
                    .map(|value| (column.column.id, value))
            })
            .collect(),
    }
}

impl<R, D, C, E, A, B> DatabasesServiceImpl<R, D, C, E, A, B>
where
    R: DatabasesRepo,
    D: ColumnDefinitionStore,
    C: CellStore,
    E: TableEventPublisher,
    A: AccessDirectory,
    B: MacroEventBroker,
{
    /// The columns of `tables` with their definitions, by table, then in
    /// display order.
    async fn column_entries(&self, tables: &[TableId]) -> Result<Vec<ColumnEntry>, DatabaseError> {
        let columns = self
            .repository
            .columns_for_tables(tables)
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
        columns
            .into_iter()
            .map(|column| {
                Ok(ColumnEntry {
                    definition: definitions
                        .get(&column.property_definition_id)
                        .cloned()
                        .ok_or(DatabaseError::NotFound)?,
                    column,
                    writable: true,
                })
            })
            .collect()
    }

    async fn storage_entries(&self, id: DatabaseId) -> Result<Vec<StorageTable>, DatabaseError> {
        let tables = self
            .repository
            .tables_for_databases(&[id])
            .await
            .map_err(repository_error)?;
        let ids: Vec<_> = tables.iter().map(|table| table.id).collect();
        let columns = self.column_entries(&ids).await?;
        let views = self
            .repository
            .views_for_tables(&ids)
            .await
            .map_err(repository_error)?;
        Ok(tables
            .into_iter()
            .map(|table| StorageTable {
                columns: columns
                    .iter()
                    .filter(|column| column.column.table_id == table.id)
                    .cloned()
                    .collect(),
                views: views
                    .iter()
                    .filter(|view| view.table_id == table.id)
                    .cloned()
                    .collect(),
                table,
            })
            .collect())
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
    #[tracing::instrument(name = "database.storage.board_positions", skip_all, fields(database_id = %id, table_id = %table, view_id = %view), err)]
    async fn storage_view_positions(
        &self,
        id: DatabaseId,
        table: TableId,
        view: ViewId,
    ) -> Result<Vec<CardPosition>, DatabaseError> {
        let tables = self
            .repository
            .tables_for_databases(&[id])
            .await
            .map_err(repository_error)?;
        if !tables.iter().any(|entry| entry.id == table) {
            return Err(DatabaseError::NotFound);
        }
        let views = self
            .repository
            .views_for_tables(&[table])
            .await
            .map_err(repository_error)?;
        if !views.iter().any(|entry| entry.id == view) {
            return Err(DatabaseError::NotFound);
        }
        self.repository
            .view_positions(view)
            .await
            .map_err(repository_error)
    }

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
                    .map(|column| column_detail(column, id))
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
        let next = page
            .last()
            .copied()
            .filter(|_| start + page.len() < ordered.len());
        let rows = page
            .into_iter()
            .map(|row_id| {
                storage_row(
                    row_id,
                    &values.remove(&row_id).unwrap_or_default(),
                    &entry.columns,
                )
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

    async fn storage_row_cells(
        &self,
        id: DatabaseId,
        table: TableId,
        rows: &[RowId],
    ) -> Result<Vec<StorageRow>, DatabaseError> {
        Ok(self
            .storage_tables_rows(&[StorageRowsRead {
                database: id,
                table,
                rows: rows.to_vec(),
            }])
            .await?
            .pop()
            .ok_or(DatabaseError::NotFound)?
            .rows)
    }

    async fn storage_tables_rows(
        &self,
        reads: &[StorageRowsRead],
    ) -> Result<Vec<StorageTableRows>, DatabaseError> {
        if reads.is_empty() {
            return Ok(Vec::new());
        }
        let mut databases: Vec<_> = reads.iter().map(|read| read.database).collect();
        databases.sort();
        databases.dedup();
        let tables = self
            .repository
            .tables_for_databases(&databases)
            .await
            .map_err(repository_error)?;
        let reads: Vec<_> = reads
            .iter()
            .filter(|read| {
                tables
                    .iter()
                    .any(|table| table.id == read.table && table.database_id == read.database)
            })
            .collect();
        if reads.is_empty() {
            return Ok(Vec::new());
        }
        let table_ids: Vec<_> = reads.iter().map(|read| read.table).collect();
        let columns = self.column_entries(&table_ids).await?;
        // A row counts only for the table it was asked for with.
        let asked: HashSet<_> = reads
            .iter()
            .flat_map(|read| read.rows.iter().map(|row| (read.table, *row)))
            .collect();
        let row_ids: Vec<_> = asked.iter().map(|(_, row)| *row).collect();
        let wanted: Vec<_> = self
            .repository
            .rows_in_tables(&table_ids, &row_ids)
            .await
            .map_err(repository_error)?
            .into_iter()
            .map(|(table, row)| (table, row.id))
            .filter(|wanted| asked.contains(wanted))
            .collect();
        let ids: Vec<_> = wanted.iter().map(|(_, row)| *row).collect();
        let cells = self.cells.cells(&ids).await.map_err(repository_error)?;
        let empty = HashMap::new();
        Ok(reads
            .into_iter()
            .map(|read| {
                let columns: Vec<_> = columns
                    .iter()
                    .filter(|column| column.column.table_id == read.table)
                    .cloned()
                    .collect();
                // Only this read's rows, even when another read names the
                // same table.
                let named: HashSet<_> = read.rows.iter().collect();
                let rows = wanted
                    .iter()
                    .filter(|(table, row)| *table == read.table && named.contains(row))
                    .map(|(_, row)| storage_row(*row, cells.get(row).unwrap_or(&empty), &columns))
                    .collect();
                StorageTableRows {
                    table: read.table,
                    columns: columns
                        .into_iter()
                        .map(|column| column_detail(column, read.database))
                        .collect(),
                    rows,
                }
            })
            .collect())
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
