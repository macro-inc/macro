//! The entity-mutation lifecycle capabilities for databases: rename,
//! duplicate, trash, restore and permanent delete; the router reports the
//! rest unsupported.

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use entity_mutation::{
    DeleteEntityPermanently, DuplicateEntity, EntityMutationEffect, EntityMutationErrorCode,
    RenameEntity, RestoreEntity, TrashEntity,
};
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

use super::{
    duplicate::{DatabaseDuplicateRepo, DatabaseDuplicateService},
    models::DatabaseError,
    ports::{
        AccessDirectory, CellStore, ColumnDefinitionStore, DatabasesRepo, DatabasesService,
        TableEventPublisher,
    },
    service::DatabasesServiceImpl,
};

impl From<DatabaseError> for EntityMutationErrorCode {
    fn from(error: DatabaseError) -> Self {
        match error {
            error @ DatabaseError::NotFound => Self::not_found(rootcause::report!(error)),
            error @ DatabaseError::Unauthorized => Self::forbidden(rootcause::report!(error)),
            error @ (DatabaseError::InvalidSchemaOperation(_)
            | DatabaseError::InvalidSharing(_)
            | DatabaseError::InvalidOp(_)
            | DatabaseError::OptionInUse
            | DatabaseError::RowInUse
            | DatabaseError::VersionConflict) => Self::invalid(rootcause::report!(error)),
            error @ DatabaseError::Repo(_) => Self::internal(rootcause::report!(error)),
        }
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> RenameEntity
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    type Receipt = EditAccessLevel;

    async fn rename_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        DatabasesService::rename_database(self, receipt, display_name).await?;
        Ok(vec![EntityMutationEffect::updated(entity)])
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DuplicateEntity
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore + DatabaseDuplicateRepo,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    type Receipt = ViewAccessLevel;

    async fn duplicate_entity(
        &self,
        _entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        user_id: MacroUserIdStr<'static>,
        display_name: Option<String>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let copy =
            DatabaseDuplicateService::duplicate_database(self, receipt, user_id, display_name)
                .await?;
        Ok(vec![EntityMutationEffect::updated(
            EntityType::Database.with_entity_string(copy.id.to_string()),
        )])
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> TrashEntity
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    type Receipt = OwnerAccessLevel;

    async fn trash_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        DatabasesService::trash_database(self, receipt).await?;
        // Tables, columns, and rows have no cache identity of their own; the
        // database is the only entity surfaced to clients.
        Ok(vec![EntityMutationEffect::deleted(entity)])
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> RestoreEntity
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    type Receipt = OwnerAccessLevel;

    async fn restore_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        DatabasesService::restore_database(self, receipt).await?;
        Ok(vec![EntityMutationEffect::updated(entity)])
    }
}

impl<Repository, Definitions, Cells, Events, Access, Broker> DeleteEntityPermanently
    for DatabasesServiceImpl<Repository, Definitions, Cells, Events, Access, Broker>
where
    Repository: DatabasesRepo,
    Definitions: ColumnDefinitionStore,
    Cells: CellStore,
    Events: TableEventPublisher,
    Access: AccessDirectory,
    Broker: MacroEventBroker,
{
    type Receipt = OwnerAccessLevel;

    async fn delete_entity_permanently(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        DatabasesService::delete_database_permanently(self, receipt).await?;
        Ok(vec![EntityMutationEffect::deleted(entity)])
    }
}
