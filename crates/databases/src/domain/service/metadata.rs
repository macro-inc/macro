//! A database's own facts for a domain that decides access itself.

use super::*;
use entity_access::domain::models::EntityType;

use crate::domain::ports::DatabaseMetadataReads;

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
