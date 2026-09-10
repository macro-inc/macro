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
    models::{AccessError, EditAccessLevel, EntityAccessReceipt, RequiredPermission},
    ports::EntityAccessService,
};
use entity_mutation::{
    DeleteEntityPermanently, DuplicateEntity, DuplicateEntityRequest, EntityMutationActor,
    EntityMutationEffect, EntityMutationErrorCode, EntityMutationService, EntityMutationSuccess,
    MoveEntity, MoveEntityRequest, MutateEntitiesResult, RenameEntity, RenameEntityRequest,
    RestoreEntity, TrashEntity, UpdateEntitySharePolicy, UpdateEntitySharePolicyRequest,
    capability::MoveEntityRequest as CapabilityMoveEntityRequest,
};
use futures::{StreamExt, stream};
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use projects_hex::domain::ports::ProjectService;

#[cfg(test)]
mod test;

/// Upper bound on how many items of one batch run against downstream
/// services at once. `buffered` preserves input order, so results still map
/// one-to-one onto inputs.
const MAX_CONCURRENT_ENTITY_MUTATIONS: usize = 16;

/// Error returned by [`EntityLifecycleService`] operations.
#[derive(Debug, thiserror::Error)]
pub enum LifecycleError {
    /// The requested entity does not exist.
    #[error("entity not found")]
    NotFound,
    /// The request violates an input invariant.
    #[error("invalid lifecycle input: {0}")]
    InvalidInput(String),
    /// Infrastructure or persistence failed.
    #[error("internal lifecycle failure: {0}")]
    Internal(rootcause::Report),
}

/// Document and email-thread mutations still orchestrated directly against
/// persistence instead of a domain service.
///
/// Each method should migrate behind the domain port that owns its entity
/// kind and become a capability-trait impl there (projects already
/// graduated); delete this trait once it is empty.
pub trait EntityLifecycleService: Send + Sync + 'static {
    /// Update an email thread's share policy.
    fn update_thread_share_policy(
        &self,
        actor: &EntityMutationActor,
        entity: &Entity<'static>,
        policy: UpdateSharePermissionRequestV2,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, LifecycleError>> + Send;
    /// Restore a document.
    fn restore_document(
        &self,
        actor: &EntityMutationActor,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, LifecycleError>> + Send;
    /// Permanently delete a document.
    fn delete_document_permanently(
        &self,
        actor: &EntityMutationActor,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, LifecycleError>> + Send;
}

/// Result of one mutation routed by this service.
type EntityMutationResult = MutateEntitiesResult;

/// Map an access failure on the requested entity onto the public vocabulary.
fn access_failure(error: AccessError) -> EntityMutationErrorCode {
    match error {
        error @ (AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_)) => {
            EntityMutationErrorCode::forbidden(rootcause::report!(error))
        }
        error @ AccessError::NotFound(_) => {
            EntityMutationErrorCode::not_found(rootcause::report!(error))
        }
        error @ AccessError::BadRequest(_) => {
            EntityMutationErrorCode::invalid(rootcause::report!(error))
        }
        error @ (AccessError::Unavailable(_) | AccessError::Internal(_)) => {
            EntityMutationErrorCode::internal(rootcause::report!(error))
        }
    }
}

/// Map an access failure on the target project of a move.
fn target_project_failure(error: AccessError) -> EntityMutationErrorCode {
    access_failure(error)
}

/// Map a lifecycle-port failure onto the public vocabulary.
fn lifecycle_failure(error: LifecycleError) -> EntityMutationErrorCode {
    match error {
        LifecycleError::NotFound => {
            EntityMutationErrorCode::not_found(rootcause::report!(LifecycleError::NotFound))
        }
        LifecycleError::InvalidInput(message) => EntityMutationErrorCode::invalid(
            rootcause::report!(LifecycleError::InvalidInput(message)),
        ),
        LifecycleError::Internal(report) => {
            EntityMutationErrorCode::internal(rootcause::report!(LifecycleError::Internal(report)))
        }
    }
}

/// Build an unsupported-operation result for an entity.
fn unsupported(entity: Entity<'static>, operation: &'static str) -> EntityMutationResult {
    Err(EntityMutationErrorCode::unsupported(
        rootcause::report!(entity).attach(operation),
    ))
}

/// Wrap domain-classified effects in the unified success result.
fn success(effects: Vec<EntityMutationEffect>) -> EntityMutationResult {
    Ok(EntityMutationSuccess { effects })
}

async fn collect_ordered<F>(futures: impl IntoIterator<Item = F>) -> Vec<EntityMutationResult>
where
    F: Future<Output = EntityMutationResult>,
{
    stream::iter(futures)
        .buffered(MAX_CONCURRENT_ENTITY_MUTATIONS)
        .collect()
        .await
}

/// Unified entity mutation router wired from the domain services.
#[derive(Clone)]
pub struct DssEntityMutationService<D, H, C, K, E, P, A, L> {
    documents: Arc<D>,
    chats: Arc<H>,
    channels: Arc<C>,
    calls: Arc<K>,
    email: Arc<E>,
    projects: Arc<P>,
    access: Arc<A>,
    lifecycle: Arc<L>,
}

impl<D, H, C, K, E, P, A, L> DssEntityMutationService<D, H, C, K, E, P, A, L> {
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
            lifecycle,
        }
    }
}

impl<D, H, C, K, E, P, A, L> DssEntityMutationService<D, H, C, K, E, P, A, L>
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
    L: EntityLifecycleService,
{
    /// Resolve the access receipt a capability impl requires.
    async fn receipt<T: RequiredPermission>(
        &self,
        actor: &EntityMutationActor,
        entity: &Entity<'static>,
    ) -> Result<EntityAccessReceipt<T>, EntityMutationErrorCode> {
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

    /// Require edit access on the target project of a move.
    async fn target_project(
        &self,
        actor: &EntityMutationActor,
        project_id: &str,
    ) -> Result<EntityAccessReceipt<EditAccessLevel>, EntityMutationErrorCode> {
        self.access
            .generate_entity_access_receipt::<EditAccessLevel>(
                &actor.user_id,
                actor.organization_id,
                project_id,
                EntityType::Project,
            )
            .await
            .map_err(target_project_failure)
    }

    /// Resolve a receipt and dispatch a rename to the owning domain.
    async fn rename_with<S: RenameEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
        display_name: String,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
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
        requested: &Entity<'static>,
        project_id: Option<String>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        let request = match project_id {
            Some(project_id) => {
                let project_receipt = self.target_project(actor, &project_id).await?;
                CapabilityMoveEntityRequest::MoveToProject {
                    entity: requested.clone(),
                    receipt,
                    project_id,
                    project_receipt,
                }
            }
            None => CapabilityMoveEntityRequest::MoveToRoot {
                entity: requested.clone(),
                receipt,
            },
        };
        service.move_entity(request).await
    }

    /// Resolve a receipt and dispatch a share-policy update.
    async fn share_with<S: UpdateEntitySharePolicy>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
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
        requested: &Entity<'static>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service.trash_entity(requested.clone(), receipt).await
    }

    /// Resolve a receipt and dispatch a restore operation.
    async fn restore_with<S: RestoreEntity>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let receipt = self.receipt::<S::Receipt>(actor, requested).await?;
        service.restore_entity(requested.clone(), receipt).await
    }

    /// Resolve a receipt and dispatch a permanent deletion.
    async fn delete_with<S: DeleteEntityPermanently>(
        &self,
        service: &S,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
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
        requested: &Entity<'static>,
        display_name: Option<String>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
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
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "rename");
            }
        };
        result.and_then(success)
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn move_one(
        &self,
        actor: &EntityMutationActor,
        request: MoveEntityRequest,
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "move");
            }
        };
        result.and_then(success)
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn update_share_policy_one(
        &self,
        actor: &EntityMutationActor,
        request: UpdateEntitySharePolicyRequest,
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "share policy updates");
            }
        };
        result.and_then(success)
    }

    /// Email threads still update share policy through the lifecycle port.
    async fn share_email_thread(
        &self,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
        policy: UpdateSharePermissionRequestV2,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        self.receipt::<entity_access::domain::models::OwnerAccessLevel>(actor, requested)
            .await?;
        let affected = self
            .lifecycle
            .update_thread_share_policy(actor, requested, policy)
            .await
            .map_err(lifecycle_failure)?;
        Ok(
            std::iter::once(EntityMutationEffect::updated(requested.clone()))
                .chain(affected.into_iter().map(EntityMutationEffect::updated))
                .collect(),
        )
    }

    #[tracing::instrument(skip_all, fields(entity_type = %requested.entity_type, entity_id = %requested.entity_id))]
    async fn trash_one(
        &self,
        actor: &EntityMutationActor,
        requested: Entity<'static>,
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "trash");
            }
        };
        result.and_then(success)
    }

    #[tracing::instrument(skip_all, fields(entity_type = %requested.entity_type, entity_id = %requested.entity_id))]
    async fn restore_one(
        &self,
        actor: &EntityMutationActor,
        requested: Entity<'static>,
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "restore");
            }
        };
        result.and_then(success)
    }

    /// Documents still restore through the lifecycle port.
    async fn restore_document(
        &self,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        self.receipt::<entity_access::domain::models::OwnerAccessLevel>(actor, requested)
            .await?;
        let affected = self
            .lifecycle
            .restore_document(actor, requested)
            .await
            .map_err(lifecycle_failure)?;
        Ok(
            std::iter::once(EntityMutationEffect::updated(requested.clone()))
                .chain(affected.into_iter().map(EntityMutationEffect::updated))
                .collect(),
        )
    }

    #[tracing::instrument(skip_all, fields(entity_type = %requested.entity_type, entity_id = %requested.entity_id))]
    async fn delete_permanently_one(
        &self,
        actor: &EntityMutationActor,
        requested: Entity<'static>,
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "permanent deletion");
            }
        };
        result.and_then(success)
    }

    /// Documents still delete permanently through the lifecycle port.
    async fn delete_document_permanently(
        &self,
        actor: &EntityMutationActor,
        requested: &Entity<'static>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        self.receipt::<entity_access::domain::models::OwnerAccessLevel>(actor, requested)
            .await?;
        let affected = self
            .lifecycle
            .delete_document_permanently(actor, requested)
            .await
            .map_err(lifecycle_failure)?;
        Ok(
            std::iter::once(EntityMutationEffect::deleted(requested.clone()))
                .chain(affected.into_iter().map(EntityMutationEffect::updated))
                .collect(),
        )
    }

    #[tracing::instrument(skip_all, fields(entity_type = %request.entity.entity_type, entity_id = %request.entity.entity_id))]
    async fn duplicate_one(
        &self,
        actor: &EntityMutationActor,
        request: DuplicateEntityRequest,
    ) -> EntityMutationResult {
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
            | EntityType::CrmContact
            | EntityType::CalendarEvent
            | EntityType::Reminder
            | EntityType::Skill
            | EntityType::AgentSession => {
                return unsupported(requested, "duplication");
            }
        };
        result.and_then(success)
    }
}

impl<D, H, C, K, E, P, A, L> EntityMutationService
    for DssEntityMutationService<D, H, C, K, E, P, A, L>
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
    L: EntityLifecycleService,
{
    async fn rename_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<RenameEntityRequest>,
    ) -> Vec<EntityMutationResult> {
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
    ) -> Vec<EntityMutationResult> {
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
    ) -> Vec<EntityMutationResult> {
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
        entities: Vec<Entity<'static>>,
    ) -> Vec<EntityMutationResult> {
        let mut futures = Vec::with_capacity(entities.len());
        for entity in entities {
            futures.push(self.trash_one(&actor, entity));
        }
        collect_ordered(futures).await
    }

    async fn restore_entities(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<EntityMutationResult> {
        let mut futures = Vec::with_capacity(entities.len());
        for entity in entities {
            futures.push(self.restore_one(&actor, entity));
        }
        collect_ordered(futures).await
    }

    async fn delete_entities_permanently(
        &self,
        actor: EntityMutationActor,
        entities: Vec<Entity<'static>>,
    ) -> Vec<EntityMutationResult> {
        let mut futures = Vec::with_capacity(entities.len());
        for entity in entities {
            futures.push(self.delete_permanently_one(&actor, entity));
        }
        collect_ordered(futures).await
    }

    async fn duplicate_entities(
        &self,
        actor: EntityMutationActor,
        requests: Vec<DuplicateEntityRequest>,
    ) -> Vec<EntityMutationResult> {
        collect_ordered(
            requests
                .into_iter()
                .map(|request| self.duplicate_one(&actor, request)),
        )
        .await
    }
}
