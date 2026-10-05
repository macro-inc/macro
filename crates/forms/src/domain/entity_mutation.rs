//! The entity-mutation lifecycle capabilities for forms: rename, trash,
//! restore and permanent delete. None of them touch the form's database.

use databases::domain::ports::{DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel};
use entity_mutation::{
    DeleteEntityPermanently, EntityMutationEffect, EntityMutationErrorCode, RenameEntity,
    RestoreEntity, TrashEntity,
};
use macro_event_broker::MacroEventBroker;
use model_entity::Entity;

use super::models::FormError;
use super::ports::{Clock, FormAccessDirectory, FormEventPublisher, FormsRepo, FormsService};
use super::service::FormsServiceImpl;

impl From<FormError> for EntityMutationErrorCode {
    fn from(error: FormError) -> Self {
        match error {
            error @ FormError::NotFound => Self::not_found(rootcause::report!(error)),
            error @ FormError::OwnerOnly => Self::forbidden(rootcause::report!(error)),
            error @ (FormError::Conflict
            | FormError::AlreadyResponded
            | FormError::Closed
            | FormError::TableGone) => Self::conflict(rootcause::report!(error)),
            error @ (FormError::SignInRequired
            | FormError::NoResponse
            | FormError::UnknownQuestion { .. }
            | FormError::RepeatedAnswer { .. }
            | FormError::MissingAnswer { .. }
            | FormError::InvalidAnswer { .. }
            | FormError::WidgetMismatch { .. }
            | FormError::FileUploadNeedsSignIn
            | FormError::InvalidLayout(_)
            | FormError::InvalidName(_)
            | FormError::InvalidSharing(_)
            | FormError::TallyHidden) => Self::invalid(rootcause::report!(error)),
            error @ (FormError::Database(_)
            | FormError::Repository(_)
            | FormError::AccessDirectory(_)) => Self::internal(rootcause::report!(error)),
        }
    }
}

impl<Repository, Databases, Access, Events, Now, Broker> RenameEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    type Receipt = EditAccessLevel;

    async fn rename_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        display_name: String,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        FormsService::rename_form(self, receipt, display_name).await?;
        Ok(vec![EntityMutationEffect::updated(entity)])
    }
}

impl<Repository, Databases, Access, Events, Now, Broker> TrashEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    type Receipt = OwnerAccessLevel;

    async fn trash_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        FormsService::trash_form(self, receipt).await?;
        Ok(vec![EntityMutationEffect::deleted(entity)])
    }
}

impl<Repository, Databases, Access, Events, Now, Broker> RestoreEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    type Receipt = OwnerAccessLevel;

    async fn restore_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        FormsService::restore_form(self, receipt).await?;
        Ok(vec![EntityMutationEffect::updated(entity)])
    }
}

impl<Repository, Databases, Access, Events, Now, Broker> DeleteEntityPermanently
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker>
where
    Repository: FormsRepo,
    Databases: DatabasesService + DatabaseRowReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
{
    type Receipt = OwnerAccessLevel;

    async fn delete_entity_permanently(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        FormsService::delete_form_permanently(self, receipt).await?;
        Ok(vec![EntityMutationEffect::deleted(entity)])
    }
}
