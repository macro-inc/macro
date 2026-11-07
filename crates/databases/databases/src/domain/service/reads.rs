//! Plain reads of a table's cells for a domain that decides access itself.

use super::*;
use crate::domain::journal::cell_value;
use crate::domain::models::Column;
use crate::domain::ports::DatabaseRowReads;
use models_databases::{CellValue, CellWrite};

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
    /// The table's rows and columns in order, when the receipt's database is
    /// live and holds it.
    async fn readable_table(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
    ) -> Result<(Vec<RowRef>, Vec<Column>), DatabaseError> {
        let database_id = receipt_database_id(receipt)?;
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
        let rows = self
            .repository
            .row_refs(table_id)
            .await
            .map_err(repository_error)?;
        let columns = self
            .repository
            .columns_for_tables(&[table_id])
            .await
            .map_err(repository_error)?;
        Ok((rows, columns))
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseRowReads
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self, receipt, rows), fields(rows = rows.len()), err)]
    async fn cells_of_rows(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        rows: &[RowId],
    ) -> Result<HashMap<RowId, Vec<CellWrite>>, DatabaseError> {
        let (table_rows, columns) = self.readable_table(&receipt, table_id).await?;
        let wanted: Vec<RowId> = table_rows
            .iter()
            .map(|row| row.id)
            .filter(|row| rows.contains(row))
            .collect();
        let mut stored = self.cells.cells(&wanted).await.map_err(repository_error)?;
        Ok(wanted
            .into_iter()
            .map(|row| {
                let cells = stored.remove(&row).unwrap_or_default();
                let writes = columns
                    .iter()
                    .filter_map(|column| {
                        let value = cell_value(cells.get(&column.property_definition_id)?)?;
                        Some(CellWrite {
                            column: column.id,
                            value,
                        })
                    })
                    .collect();
                (row, writes)
            })
            .collect())
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn column_cells(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
        column_id: ColumnId,
    ) -> Result<HashMap<RowId, CellValue>, DatabaseError> {
        let (table_rows, columns) = self.readable_table(&receipt, table_id).await?;
        let column = columns
            .iter()
            .find(|column| column.id == column_id)
            .ok_or(DatabaseError::NotFound)?;
        let ids: Vec<RowId> = table_rows.iter().map(|row| row.id).collect();
        let cells = self
            .cells
            .column_cells(&ids, column.property_definition_id)
            .await
            .map_err(repository_error)?;
        Ok(cells
            .into_iter()
            .filter_map(|(row, value)| Some((row, cell_value(&value)?)))
            .collect())
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn row_count(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        table_id: TableId,
    ) -> Result<u64, DatabaseError> {
        let (table_rows, _) = self.readable_table(&receipt, table_id).await?;
        u64::try_from(table_rows.len()).map_err(repository_error)
    }
}
