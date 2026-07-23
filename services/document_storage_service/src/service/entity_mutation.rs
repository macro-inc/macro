//! Document-storage router for the unified entity mutation domain port.
//!
//! This service is deliberately thin: each domain crate implements the
//! capability traits in [`entity_mutation::capability`] and owns its own
//! mapping onto its service methods, preconditions, and errors. The router
//! resolves access receipts (typed per capability by each impl's associated
//! `Receipt`), enforces the batch contract (ordering, bounded concurrency,
//! partial success), validates cross-domain inputs such as move targets, and
//! dispatches each item to the owning domain. The per-kind support matrix is
//! encoded as exhaustive matches, so adding an [`EntityType`] fails
//! compilation here until every capability decides whether to support it.
//!
//! Access-level requirements deliberately mirror the legacy REST handlers
//! for each entity kind, including their asymmetries (for example, call
//! permanent-deletion requires `Edit` while other kinds require `Owner`,
//! and chat rename/move require `Owner` while documents require `Edit`).
//! The requirement lives on each domain impl's associated `Receipt` type;
//! do not "normalize" a level without an explicit product decision.

use std::{future::Future, sync::Arc};

use call::domain::ports::CallService;
use channels::domain::ports::ChannelService;
use chat::domain::ports::ChatService;
use documents_hex::domain::ports::DocumentService;
use email::domain::ports::EmailService;
use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, EntityAccessReceipt, RequiredPermission, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use entity_mutation::{
    DeleteEntityPermanently, DuplicateEntity, DuplicateEntityRequest, EntityMutationActor,
    EntityMutationError, EntityMutationOutcome, EntityMutationService, EntityRef, MoveEntity,
    MoveEntityRequest, RenameEntity, RenameEntityRequest, RestoreEntity, TrashEntity,
    UpdateEntitySharePolicy, UpdateEntitySharePolicyRequest,
};
use favorites::domain::{models::FavoritesError, ports::FavoritesService};
use futures::{StreamExt, stream};
use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use projects_hex::domain::ports::ProjectService;

#[cfg(test)]
mod test;

/// Upper bound on how many items of one batch run against downstream
/// services at once. `buffered` preserves input order, so results still map
/// one-to-one onto inputs.
const MAX_CONCURRENT_ENTITY_MUTATIONS: usize = 16;

/// Error returned by [`EntityLifecycleService`] operations.
pub enum LifecycleError {
    /// The requested entity does not exist.
    NotFound,
    /// The request violates an input invariant.
    InvalidInput(String),
    /// Infrastructure or persistence failed.
    Internal(rootcause::Report),
}

/// Document and email-thread mutations still orchestrated directly against
/// persistence instead of a domain service.
///
/// Each method should migrate behind the domain port that owns its entity
/// kind and become a capability-trait impl there (projects already
/// graduated); delete this trait once it is empty.
#[async_trait::async_trait]
pub trait EntityLifecycleService: Send + Sync + 'static {
    /// Update an email thread's share policy.
    async fn update_thread_share_policy(
        &self,
        actor: &EntityMutationActor,
        entity: &EntityRef,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityRef>, LifecycleError>;
    /// Restore a document.
    async fn restore_document(
        &self,
        actor: &EntityMutationActor,
        entity: &EntityRef,
    ) -> Result<Vec<EntityRef>, LifecycleError>;
    /// Permanently delete a document.
    async fn delete_document_permanently(
        &self,
        actor: &EntityMutationActor,
        entity: &EntityRef,
    ) -> Result<Vec<EntityRef>, LifecycleError>;
}

/// Map an access failure on the requested entity onto the public vocabulary.
fn access_failure(error: AccessError) -> EntityMutationError {
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            EntityMutationError::forbidden("insufficient permission for entity mutation")
        }
        AccessError::NotFound(_) => EntityMutationError::not_found("entity not found"),
        AccessError::BadRequest(message) => EntityMutationError::invalid(message),
        error @ (AccessError::DatabaseError(_) | AccessError::Internal) => {
            EntityMutationError::internal(&error)
        }
    }
}

/// Map an access failure on the target project of a move.
fn target_project_failure(error: AccessError) -> EntityMutationError {
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            EntityMutationError::forbidden("insufficient permission for the target project")
        }
        AccessError::NotFound(_) => EntityMutationError::not_found("target project not found"),
        AccessError::BadRequest(message) => EntityMutationError::invalid(message),
        error @ (AccessError::DatabaseError(_) | AccessError::Internal) => {
            EntityMutationError::internal(&error)
        }
    }
}

/// Map a favorites-domain failure onto the public vocabulary.
fn favorites_failure(error: FavoritesError) -> EntityMutationError {
    match error {
        FavoritesError::NotFound => EntityMutationError::not_found("favorite not found"),
        FavoritesError::BadRequest(message) => EntityMutationError::invalid(message),
        FavoritesError::Unauthorized => {
            EntityMutationError::forbidden("you do not have access to this entity")
        }
        error @ FavoritesError::Internal(_) => EntityMutationError::internal(&error),
    }
}

/// Map a lifecycle-port failure onto the public vocabulary.
fn lifecycle_failure(error: LifecycleError) -> EntityMutationError {
    match error {
        LifecycleError::NotFound => EntityMutationError::not_found("entity not found"),
        LifecycleError::InvalidInput(message) => EntityMutationError::invalid(message),
        LifecycleError::Internal(report) => EntityMutationError::internal(&report),
    }
}

/// Build a success outcome, guaranteeing the requested entity itself is
/// listed as affected ahead of any extra records the domain reported.
fn success_with_affected(requested: EntityRef, affected: Vec<EntityRef>) -> EntityMutationOutcome {
    let mut affected_entities = affected;
    if !affected_entities.contains(&requested) {
        affected_entities.insert(0, requested.clone());
    }
    EntityMutationOutcome::success_with(requested.clone(), Some(requested), affected_entities)
}

/// Entity kinds a user may favorite.
///
/// Exhaustive so a new [`EntityType`] variant is a deliberate decision here,
/// not a silent default.
fn favoritable(entity_type: EntityType) -> bool {
    match entity_type {
        EntityType::Document
        | EntityType::Project
        | EntityType::Chat
        | EntityType::Channel
        | EntityType::EmailThread
        | EntityType::Call
        | EntityType::ForeignEntity
        | EntityType::StaticFile
        | EntityType::CrmCompany
        | EntityType::CrmContact => true,
        EntityType::User | EntityType::Team | EntityType::ChannelMessage => false,
    }
}

async fn collect_ordered<F>(futures: impl IntoIterator<Item = F>) -> Vec<EntityMutationOutcome>
where
    F: Future<Output = EntityMutationOutcome>,
{
    stream::iter(futures)
        .buffered(MAX_CONCURRENT_ENTITY_MUTATIONS)
        .collect()
        .await
}

/// Unified entity mutation router wired from the domain services.
#[derive(Clone)]
pub struct DssEntityMutationService<D, H, C, K, E, P, A, F, L> {
    documents: Arc<D>,
    chats: Arc<H>,
    channels: Arc<C>,
    calls: Arc<K>,
    email: Arc<E>,
    projects: Arc<P>,
    access: Arc<A>,
    favorites: Arc<F>,
    lifecycle: Arc<L>,
}

impl<D, H, C, K, E, P, A, F, L> DssEntityMutationService<D, H, C, K, E, P, A, F, L> {
    /// Compose the unified mutation router from domain services.
    #[expect(
        clippy::too_many_arguments,
        reason = "composition root wiring: one dependency per domain"
    )]
    pub fn new(
        documents: Arc<D>,
        chats: Arc<H>,
        channels: Arc<C>,
        calls: Arc<K>,
        email: Arc<E>,
        projects: Arc<P>,
        access: Arc<A>,
        favorites: Arc<F>,
        lifecycle: Arc<L>,
    ) -> Self {
        Self {
            documents,
            chats,
            channels,
            calls,
            email,
            projects,
            access,
            favorites,
            lifecycle,
        }
    }
}

impl<D, H, C, K, E, P, A, F, L> DssEntityMutationService<D, H, C, K, E, P, A, F, L>
where
    D: DocumentService
        + RenameEntity
        + MoveEntity
        + UpdateEntitySharePolicy
        + TrashEntity
        + DuplicateEntity,
    H: ChatService
        + RenameEntity
        + MoveEntity
        + UpdateEntitySharePolicy
        + TrashEntity
        + RestoreEntity
        + DeleteEntityPermanently
        + DuplicateEntity,
    C: ChannelService + RenameEntity + DeleteEntityPermanently,
    K: CallService + RenameEntity + UpdateEntitySharePolicy + DeleteEntityPermanently,
    E: EmailService + MoveEntity,
    P: ProjectService
        + RenameEntity
        + MoveEntity
        + UpdateEntitySharePolicy
        + TrashEntity
        + RestoreEntity
        + DeleteEntityPermanently,
    A: EntityAccessService,
    F: FavoritesService,
    L: EntityLifecycleService,
{
    /// Resolve the access receipt a capability impl requires.
    async fn receipt<T: RequiredPermission>(
        &self,
        actor: &EntityMutationActor,
        entity: &EntityRef,
    ) -> Result<EntityAccessReceipt<T>, EntityMutationError> {
        self.access
            .generate_entity_access_receipt::<T>(
                &actor.user_id,
                actor.organization_id,
                &entity.entity_id,
                entity.entity_type,
            )
            .await
            .map_err(access_failure)
    }

    /// Require edit access on the target project of a move, when one is set.
    async fn target_project(
        &self,
        actor: &EntityMutationActor,
        project_id: Option<&str>,
    ) -> Result<Option<EntityAccessReceipt<EditAccessLevel>>, EntityMutationError> {
        let Some(project_id) = project_id else {
            return Ok(None);
        };
        self.access
            .generate_entity_access_receipt::<EditAccessLevel>(
                &actor.user_id,
                actor.organization_id,
                project_id,
                EntityType::Project,
            )
            .await
            .map(Some)
            .map_err(target_project_failure)
    }

    /// Resolve a receipt and dispatch a rename to the owning domain.
    async fn rename_with<S: RenameEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
        display_name: String,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service
            .rename_entity(requested.clone(), receipt, display_name)
            .await
    }

    /// Resolve receipts and dispatch a move to the owning domain.
    async fn move_with<S: MoveEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
        project_id: Option<String>,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        let project_receipt = self.target_project(actor, project_id.as_deref()).await?;
        service
            .move_entity(requested.clone(), receipt, project_id, project_receipt)
            .await
    }

    /// Resolve a receipt and dispatch a share-policy update.
    async fn share_with<S: UpdateEntitySharePolicy>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service
            .update_share_policy(requested.clone(), receipt, policy)
            .await
    }

    /// Resolve a receipt and dispatch a trash operation.
    async fn trash_with<S: TrashEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service.trash_entity(requested.clone(), receipt).await
    }

    /// Resolve a receipt and dispatch a restore operation.
    async fn restore_with<S: RestoreEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service.restore_entity(requested.clone(), receipt).await
    }

    /// Resolve a receipt and dispatch a permanent deletion.
    async fn delete_with<S: DeleteEntityPermanently>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service
            .delete_entity_permanently(requested.clone(), receipt)
            .await
    }

    /// Resolve a receipt and dispatch a duplication.
    async fn duplicate_with<S: DuplicateEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &EntityRef,
        display_name: Option<String>,
    ) -> Result<EntityRef, EntityMutationError> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service
            .duplicate_entity(
                requested.clone(),
                receipt,
                actor.user_id.clone(),
                display_name,
            )
            .await
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn rename_one(
        &self,
        actor: &EntityMutationActor,
        request: RenameEntityRequest,
    ) -> EntityMutationOutcome {
        let RenameEntityRequest {
            entity: requested,
            display_name,
        } = request;
        let result = match requested.entity_type {
            EntityType::Document => {
                self.rename_with(&*self.documents, actor, &requested, display_name)
                    .await
            }
            EntityType::Chat => {
                self.rename_with(&*self.chats, actor, &requested, display_name)
                    .await
            }
            EntityType::Channel => {
                self.rename_with(&*self.channels, actor, &requested, display_name)
                    .await
            }
            EntityType::Call => {
                self.rename_with(&*self.calls, actor, &requested, display_name)
                    .await
            }
            EntityType::Project => {
                self.rename_with(&*self.projects, actor, &requested, display_name)
                    .await
            }
            EntityType::User
            | EntityType::Team
            | EntityType::ChannelMessage
            | EntityType::EmailThread
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "rename");
            }
        };
        match result {
            Ok(affected) => success_with_affected(requested, affected),
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn move_one(
        &self,
        actor: &EntityMutationActor,
        request: MoveEntityRequest,
    ) -> EntityMutationOutcome {
        let MoveEntityRequest {
            entity: requested,
            project_id,
        } = request;
        let result = match requested.entity_type {
            EntityType::Document => {
                self.move_with(&*self.documents, actor, &requested, project_id)
                    .await
            }
            EntityType::Chat => {
                self.move_with(&*self.chats, actor, &requested, project_id)
                    .await
            }
            EntityType::EmailThread => {
                self.move_with(&*self.email, actor, &requested, project_id)
                    .await
            }
            EntityType::Project => {
                self.move_with(&*self.projects, actor, &requested, project_id)
                    .await
            }
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::ChannelMessage
            | EntityType::Call
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "move");
            }
        };
        match result {
            Ok(affected) => success_with_affected(requested, affected),
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn update_share_policy_one(
        &self,
        actor: &EntityMutationActor,
        request: UpdateEntitySharePolicyRequest,
    ) -> EntityMutationOutcome {
        let UpdateEntitySharePolicyRequest {
            entity: requested,
            policy,
        } = request;
        let result = match requested.entity_type {
            EntityType::Document => {
                self.share_with(&*self.documents, actor, &requested, policy)
                    .await
            }
            EntityType::Chat => {
                self.share_with(&*self.chats, actor, &requested, policy)
                    .await
            }
            EntityType::Call => {
                self.share_with(&*self.calls, actor, &requested, policy)
                    .await
            }
            EntityType::Project => {
                self.share_with(&*self.projects, actor, &requested, policy)
                    .await
            }
            EntityType::EmailThread => self.share_email_thread(actor, &requested, policy).await,
            // Channels grant access through participant roles and channel
            // messages inherit from their channel; neither has a share policy.
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::ChannelMessage
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "share policy updates");
            }
        };
        match result {
            Ok(affected) => success_with_affected(requested, affected),
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    /// Email threads still update share policy through the lifecycle port.
    async fn share_email_thread(
        &self,
        actor: &EntityMutationActor,
        requested: &EntityRef,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        self.receipt::<entity_access::domain::models::OwnerAccessLevel>(actor, requested)
            .await?;
        self.lifecycle
            .update_thread_share_policy(actor, requested, policy)
            .await
            .map_err(lifecycle_failure)
    }

    #[tracing::instrument(skip_all, fields(entity_type = %requested.entity_type, entity_id = %requested.entity_id))]
    async fn trash_one(
        &self,
        actor: &EntityMutationActor,
        requested: EntityRef,
    ) -> EntityMutationOutcome {
        let result = match requested.entity_type {
            EntityType::Document => self.trash_with(&*self.documents, actor, &requested).await,
            EntityType::Chat => self.trash_with(&*self.chats, actor, &requested).await,
            EntityType::Project => self.trash_with(&*self.projects, actor, &requested).await,
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::ChannelMessage
            | EntityType::EmailThread
            | EntityType::Call
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "trash");
            }
        };
        match result {
            Ok(affected) => success_with_affected(requested, affected),
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    #[tracing::instrument(skip_all, fields(entity_type = %requested.entity_type, entity_id = %requested.entity_id))]
    async fn restore_one(
        &self,
        actor: &EntityMutationActor,
        requested: EntityRef,
    ) -> EntityMutationOutcome {
        let result = match requested.entity_type {
            EntityType::Document => self.restore_document(actor, &requested).await,
            EntityType::Chat => self.restore_with(&*self.chats, actor, &requested).await,
            EntityType::Project => self.restore_with(&*self.projects, actor, &requested).await,
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::ChannelMessage
            | EntityType::EmailThread
            | EntityType::Call
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "restore");
            }
        };
        match result {
            Ok(affected) => success_with_affected(requested, affected),
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    /// Documents still restore through the lifecycle port.
    async fn restore_document(
        &self,
        actor: &EntityMutationActor,
        requested: &EntityRef,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        self.receipt::<entity_access::domain::models::OwnerAccessLevel>(actor, requested)
            .await?;
        self.lifecycle
            .restore_document(actor, requested)
            .await
            .map_err(lifecycle_failure)
    }

    #[tracing::instrument(skip_all, fields(entity_type = %requested.entity_type, entity_id = %requested.entity_id))]
    async fn delete_permanently_one(
        &self,
        actor: &EntityMutationActor,
        requested: EntityRef,
    ) -> EntityMutationOutcome {
        let result = match requested.entity_type {
            EntityType::Document => self.delete_document_permanently(actor, &requested).await,
            EntityType::Chat => self.delete_with(&*self.chats, actor, &requested).await,
            EntityType::Channel => self.delete_with(&*self.channels, actor, &requested).await,
            EntityType::Call => self.delete_with(&*self.calls, actor, &requested).await,
            EntityType::Project => self.delete_with(&*self.projects, actor, &requested).await,
            EntityType::User
            | EntityType::Team
            | EntityType::ChannelMessage
            | EntityType::EmailThread
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "permanent deletion");
            }
        };
        match result {
            Ok(affected) => success_with_affected(requested, affected),
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    /// Documents still delete permanently through the lifecycle port.
    async fn delete_document_permanently(
        &self,
        actor: &EntityMutationActor,
        requested: &EntityRef,
    ) -> Result<Vec<EntityRef>, EntityMutationError> {
        self.receipt::<entity_access::domain::models::OwnerAccessLevel>(actor, requested)
            .await?;
        self.lifecycle
            .delete_document_permanently(actor, requested)
            .await
            .map_err(lifecycle_failure)
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn duplicate_one(
        &self,
        actor: &EntityMutationActor,
        request: DuplicateEntityRequest,
    ) -> EntityMutationOutcome {
        let DuplicateEntityRequest {
            entity: requested,
            display_name,
        } = request;
        let result = match requested.entity_type {
            EntityType::Document => {
                self.duplicate_with(&*self.documents, actor, &requested, display_name)
                    .await
            }
            EntityType::Chat => {
                self.duplicate_with(&*self.chats, actor, &requested, display_name)
                    .await
            }
            EntityType::User
            | EntityType::Team
            | EntityType::Channel
            | EntityType::ChannelMessage
            | EntityType::EmailThread
            | EntityType::Project
            | EntityType::Call
            | EntityType::ForeignEntity
            | EntityType::StaticFile
            | EntityType::CrmCompany
            | EntityType::CrmContact => {
                return EntityMutationOutcome::unsupported(requested, "duplication");
            }
        };
        match result {
            Ok(created) => {
                EntityMutationOutcome::success_with(requested, Some(created.clone()), vec![created])
            }
            Err(error) => EntityMutationOutcome::failure(requested, error),
        }
    }

    async fn set_favorite_one(
        &self,
        actor: &EntityMutationActor,
        entity: &EntityRef,
        favorite: bool,
    ) -> Result<(), EntityMutationError> {
        if favorite {
            // The view receipt both proves visibility and carries the actor
            // and entity for the favorites domain.
            let receipt = self.receipt::<ViewAccessLevel>(actor, entity).await?;
            self.favorites
                .add_favorite(&receipt)
                .await
                .map_err(favorites_failure)?;
        } else {
            let domain_entity = entity
                .entity_type
                .with_entity_str(entity.entity_id.as_str());
            self.favorites
                .remove_favorite_by_entity(&actor.user_id, &domain_entity)
                .await
                .map_err(favorites_failure)?;
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl<D, H, C, K, E, P, A, F, L> EntityMutationService
    for DssEntityMutationService<D, H, C, K, E, P, A, F, L>
where
    D: DocumentService
        + RenameEntity
        + MoveEntity
        + UpdateEntitySharePolicy
        + TrashEntity
        + DuplicateEntity,
    H: ChatService
        + RenameEntity
        + MoveEntity
        + UpdateEntitySharePolicy
        + TrashEntity
        + RestoreEntity
        + DeleteEntityPermanently
        + DuplicateEntity,
    C: ChannelService + RenameEntity + DeleteEntityPermanently,
    K: CallService + RenameEntity + UpdateEntitySharePolicy + DeleteEntityPermanently,
    E: EmailService + MoveEntity,
    P: ProjectService
        + RenameEntity
        + MoveEntity
        + UpdateEntitySharePolicy
        + TrashEntity
        + RestoreEntity
        + DeleteEntityPermanently,
    A: EntityAccessService,
    F: FavoritesService,
    L: EntityLifecycleService,
{
    async fn rename_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<RenameEntityRequest>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            requests
                .into_iter()
                .map(|request| self.rename_one(&actor, request)),
        )
        .await
    }

    async fn move_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<MoveEntityRequest>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            requests
                .into_iter()
                .map(|request| self.move_one(&actor, request)),
        )
        .await
    }

    async fn update_share_policies(
        &self,
        actor: EntityMutationActor,
        requests: Vec<UpdateEntitySharePolicyRequest>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            requests
                .into_iter()
                .map(|request| self.update_share_policy_one(&actor, request)),
        )
        .await
    }

    async fn trash_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<EntityRef>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            entities
                .into_iter()
                .map(|entity| self.trash_one(&actor, entity)),
        )
        .await
    }

    async fn restore_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<EntityRef>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            entities
                .into_iter()
                .map(|entity| self.restore_one(&actor, entity)),
        )
        .await
    }

    async fn delete_entities_permanently(
        &self,
        actor: EntityMutationActor,
        entities: Vec<EntityRef>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            entities
                .into_iter()
                .map(|entity| self.delete_permanently_one(&actor, entity)),
        )
        .await
    }

    async fn duplicate_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> Vec<EntityMutationOutcome> {
        collect_ordered(
            requests
                .into_iter()
                .map(|request| self.duplicate_one(&actor, request)),
        )
        .await
    }

    #[tracing::instrument(skip_all, fields(entity_type = %entity.entity_type, entity_id = %entity.entity_id))]
    async fn set_favorite(
        &self,
        actor: EntityMutationActor,
        entity: EntityRef,
        favorite: bool,
    ) -> EntityMutationOutcome {
        if !favoritable(entity.entity_type) {
            return EntityMutationOutcome::unsupported(entity, "favorites");
        }
        match self.set_favorite_one(&actor, &entity, favorite).await {
            Ok(()) => EntityMutationOutcome::success(entity),
            Err(error) => EntityMutationOutcome::failure(entity, error),
        }
    }
}
