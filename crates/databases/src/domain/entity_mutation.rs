//! Unified entity-mutation capability impls for databases.
//!
//! Databases support the lifecycle capabilities only: rename, trash, restore,
//! and permanent deletion. They are not project members and carry no share
//! policy of their own, so move, share-policy updates, and duplication have no
//! meaning for them and are deliberately not implemented — the router reports
//! them as unsupported.

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel};
use entity_mutation::{
    DeleteEntityPermanently, EntityMutationEffect, EntityMutationErrorCode, RenameEntity,
    RestoreEntity, TrashEntity,
};
use macro_event_broker::MacroEventBroker;
use model_entity::Entity;

use super::{
    models::DatabaseError,
    ports::{
        AccessDirectory, ColumnDefinitionStore, DatabasesRepo, DatabasesService, MagicTables,
        SqlExecutor, TableEventPublisher,
    },
    service::DatabasesServiceImpl,
};

impl From<DatabaseError> for EntityMutationErrorCode {
    fn from(error: DatabaseError) -> Self {
        match error {
            error @ DatabaseError::NotFound => Self::not_found(rootcause::report!(error)),
            error @ DatabaseError::Unauthorized => Self::forbidden(rootcause::report!(error)),
            error @ DatabaseError::InvalidSchemaOperation(_) => {
                Self::invalid(rootcause::report!(error))
            }
            error @ DatabaseError::Repo(_) => Self::internal(rootcause::report!(error)),
        }
    }
}

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> RenameEntity
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
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

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> TrashEntity
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
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

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> RestoreEntity
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
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

impl<Repo, Defs, Magic, Exec, Events, Access, Broker> DeleteEntityPermanently
    for DatabasesServiceImpl<Repo, Defs, Magic, Exec, Events, Access, Broker>
where
    Repo: DatabasesRepo,
    Defs: ColumnDefinitionStore,
    Magic: MagicTables,
    Exec: SqlExecutor,
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
