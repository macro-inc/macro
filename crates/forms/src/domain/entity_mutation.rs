//! The entity-mutation capabilities for forms: rename, move between folders,
//! trash, restore and permanent delete. None of them touch the form's
//! database.

use crate::domain::drafts::{FormDraftRepository, FormDraftStore};

use databases::domain::ports::{DatabaseMetadataReads, DatabaseRowReads, DatabasesService};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel};
use entity_mutation::{
    DeleteEntityPermanently, EntityMutationEffect, EntityMutationErrorCode, MoveEntity,
    RenameEntity, RestoreEntity, TrashEntity, capability::MoveEntityRequest, project_refs,
};
use macro_event_broker::MacroEventBroker;
use model_entity::Entity;

use super::models::FormError;
use super::ports::{
    Clock, FormAccessDirectory, FormEventPublisher, FormImageFiles, FormsRepo, FormsService,
};
use super::service::FormsServiceImpl;

impl From<FormError> for EntityMutationErrorCode {
    fn from(error: FormError) -> Self {
        match error {
            error @ FormError::NotFound => Self::not_found(rootcause::report!(error)),
            error @ FormError::OwnerOnly => Self::forbidden(rootcause::report!(error)),
            error @ (FormError::Conflict
            | FormError::TableAlreadyHasForm
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
            | FormError::InvalidBranding(_)
            | FormError::TallyHidden) => Self::invalid(rootcause::report!(error)),
            error @ (FormError::Database(_)
            | FormError::Repository(_)
            | FormError::Collaboration(_)
            | FormError::AccessDirectory(_)
            | FormError::DatabaseRetained { .. }
            | FormError::DatabaseContract(_)) => Self::internal(rootcause::report!(error)),
        }
    }
}

impl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images> RenameEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
    Images: FormImageFiles,
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

impl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images> MoveEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
    Images: FormImageFiles,
{
    /// Filing a form in a folder shares it with the folder's members, which
    /// only its owner may do.
    type Receipt = OwnerAccessLevel;

    async fn move_entity(
        &self,
        request: MoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let (entity, receipt, project_id) = match request {
            MoveEntityRequest::MoveToRoot { entity, receipt } => (entity, receipt, None),
            MoveEntityRequest::MoveToProject {
                entity,
                receipt,
                project_id,
                project_receipt: _,
            } => (entity, receipt, Some(project_id)),
        };
        let previous_project_id = self.move_to_folder(&receipt, project_id.as_deref()).await?;
        Ok(std::iter::once(EntityMutationEffect::updated(entity))
            .chain(
                project_refs([previous_project_id, project_id])
                    .into_iter()
                    .map(EntityMutationEffect::updated),
            )
            .collect())
    }
}

impl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images> TrashEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
    Images: FormImageFiles,
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

impl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images> RestoreEntity
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
    Images: FormImageFiles,
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

impl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images> DeleteEntityPermanently
    for FormsServiceImpl<Repository, Databases, Access, Events, Now, Broker, Drafts, Images>
where
    Repository: FormsRepo + FormDraftRepository,
    Databases: DatabasesService + DatabaseRowReads + DatabaseMetadataReads,
    Access: FormAccessDirectory,
    Events: FormEventPublisher,
    Now: Clock,
    Broker: MacroEventBroker,
    Drafts: FormDraftStore,
    Images: FormImageFiles,
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
