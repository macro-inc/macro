//! A database's own facts for a domain that decides access itself.

use super::*;
use entity_access::domain::models::EntityType;

use crate::domain::ports::{DatabaseLifecycleReads, DatabaseMetadataReads};

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseMetadataReads
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self, receipt), err)]
    async fn database_metadata(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<Database, DatabaseError> {
        // A receipt for another kind of entity whose id parses must not read
        // the database sharing it.
        if receipt.entity().entity_type != EntityType::Database {
            return Err(DatabaseError::NotFound);
        }
        self.database_by_receipt(&receipt).await
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DatabaseLifecycleReads
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    #[tracing::instrument(skip(self), err)]
    async fn database_is_live(&self, id: DatabaseId) -> Result<bool, DatabaseError> {
        let database = self
            .repository
            .get_database(id)
            .await
            .map_err(repository_error)?;
        Ok(database.is_some_and(|(database, _)| database.trashed_at.is_none()))
    }
}
