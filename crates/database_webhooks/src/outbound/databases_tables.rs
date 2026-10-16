//! A webhook's table through the databases domain service, so its inserts
//! keep that service's validation, journal and events.

use std::sync::Arc;

use databases::domain::catalog::column_kind;
use databases::domain::models::{DatabaseError, OpBatch, Viewer};
use databases::domain::ports::DatabasesService;
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, ViewAccessLevel,
};
use models_databases::{
    CellWrite, DatabaseId, DatabaseOp, OpResult, RowId, RowsChange, RowsResult, TableId,
};

use crate::domain::mapping::WebhookColumn;
use crate::domain::ports::WebhookTables;

/// [`WebhookTables`] over the databases service.
#[derive(Debug)]
pub struct DatabasesServiceTables<Databases> {
    databases: Arc<Databases>,
}

impl<Databases> Clone for DatabasesServiceTables<Databases> {
    fn clone(&self) -> Self {
        Self {
            databases: self.databases.clone(),
        }
    }
}

impl<Databases> DatabasesServiceTables<Databases> {
    /// Tables of the databases `databases` keeps.
    pub fn new(databases: Arc<Databases>) -> Self {
        Self { databases }
    }
}

impl<Databases: DatabasesService> WebhookTables for DatabasesServiceTables<Databases> {
    async fn table_columns(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
    ) -> Result<Option<Vec<WebhookColumn>>, DatabaseError> {
        // The webhooks service has already decided the caller may use this
        // database; it reads the schema to shape a payload.
        let detail = match self
            .databases
            .get_database(
                EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
                    &database_id.to_string(),
                    EntityType::Database,
                ),
            )
            .await
        {
            Ok(detail) => detail,
            Err(DatabaseError::NotFound) => return Ok(None),
            Err(error) => return Err(error),
        };
        Ok(detail
            .tables
            .into_iter()
            .find(|table| table.table.id == table_id)
            .map(|table| {
                table
                    .columns
                    .iter()
                    .map(|column| WebhookColumn {
                        id: column.column.id,
                        name: column.name().to_string(),
                        kind: column_kind(&column.column, &column.definition),
                    })
                    .collect()
            }))
    }

    async fn insert_rows(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        table_id: TableId,
        rows: Vec<Vec<CellWrite>>,
    ) -> Result<Vec<RowId>, DatabaseError> {
        let results = self
            .databases
            .apply_ops(
                receipt,
                viewer,
                OpBatch::from(vec![DatabaseOp::Rows {
                    table: table_id,
                    change: RowsChange::Insert { rows },
                }]),
            )
            .await?;
        match results.into_iter().next() {
            Some(OpResult::Rows {
                change: RowsResult::Inserted { rows },
                ..
            }) => Ok(rows),
            other => Err(DatabaseError::Repo(rootcause::report!(
                "a row insert answered {other:?}"
            ))),
        }
    }
}
