//! A sync's table through the databases domain service, so its writes keep
//! that service's validation, journal and events.

use std::collections::HashSet;
use std::sync::Arc;

use databases::domain::catalog::{column_kind, option_display};
use databases::domain::models::{CreateDatabase, DatabaseError, OpBatch, Viewer};
use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, EntityType, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{DatabaseId, DatabaseOp, OpResult, OptionId, RowId, TableId};

use crate::domain::columns::TableColumn;
use crate::domain::ports::{SyncDatabase, SyncTable, SyncTables};

/// [`SyncTables`] over the databases service.
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

/// A read the syncs service has already decided may happen: it reads the
/// schema and rows of a database whose creator it holds an edit receipt for.
fn internal_view(database_id: DatabaseId) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(
        &database_id.to_string(),
        EntityType::Database,
    )
}

impl<Databases> SyncTables for DatabasesServiceTables<Databases>
where
    Databases: DatabasesService + DatabaseRowReads,
{
    async fn database(
        &self,
        database_id: DatabaseId,
    ) -> Result<Option<SyncDatabase>, DatabaseError> {
        let detail = match self
            .databases
            .get_database(internal_view(database_id))
            .await
        {
            Ok(detail) => detail,
            Err(DatabaseError::NotFound) => return Ok(None),
            Err(error) => return Err(error),
        };
        if detail.database.trashed_at.is_some() {
            return Ok(None);
        }
        Ok(Some(SyncDatabase {
            tables: detail
                .tables
                .into_iter()
                .map(|table| SyncTable {
                    id: table.table.id,
                    name: table.table.name.clone(),
                    columns: table
                        .columns
                        .iter()
                        .map(|column| TableColumn {
                            id: column.column.id,
                            name: column.name().to_string(),
                            kind: column_kind(&column.column, &column.definition),
                            options: column
                                .definition
                                .property_options
                                .iter()
                                .map(|option| {
                                    (
                                        OptionId::from_uuid(option.id),
                                        option_display(&option.value),
                                    )
                                })
                                .collect(),
                        })
                        .collect(),
                })
                .collect(),
        }))
    }

    async fn existing_rows(
        &self,
        database_id: DatabaseId,
        table_id: TableId,
        rows: &[RowId],
    ) -> Result<HashSet<RowId>, DatabaseError> {
        if rows.is_empty() {
            return Ok(HashSet::new());
        }
        Ok(self
            .databases
            .cells_of_rows(internal_view(database_id), table_id, rows)
            .await?
            .into_keys()
            .collect())
    }

    async fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        viewer: Viewer,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, DatabaseError> {
        self.databases
            .apply_ops(receipt, viewer, OpBatch::from(ops))
            .await
    }

    async fn create_database(
        &self,
        owner: &MacroUserIdStr<'static>,
        name: String,
    ) -> Result<(DatabaseId, TableId), DatabaseError> {
        let database = self
            .databases
            .create_database(CreateDatabase {
                name,
                owner_id: owner.clone(),
                acting_bot: None,
            })
            .await?;
        let detail = self
            .databases
            .get_database(internal_view(database.id))
            .await?;
        let starter = detail.tables.first().ok_or_else(|| {
            DatabaseError::Repo(rootcause::report!("a new database has no table"))
        })?;
        Ok((database.id, starter.table.id))
    }

    async fn delete_database(&self, database_id: DatabaseId) -> Result<(), DatabaseError> {
        self.databases
            .delete_database_permanently(
                EntityAccessReceipt::<OwnerAccessLevel>::dangerously_assert_internal_user(
                    &database_id.to_string(),
                    EntityType::Database,
                ),
            )
            .await
    }
}
