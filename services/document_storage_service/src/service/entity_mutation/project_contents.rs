//! What folder duplication borrows from the router's other domains: access
//! checks through `entity_access`, and copying documents and chats through
//! their own duplicate and move capabilities. The projects domain drives the
//! copy through this port, so it never depends on those domains.

use std::sync::Arc;

use entity_access::domain::{
    models::{
        AccessError, EditAccessLevel, EntityAccessReceipt, RequiredPermission, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use entity_mutation::{
    DeleteEntityPermanently, DuplicateEntity, EntityMutationActor, EntityMutationEffect,
    EntityMutationErrorCode, MoveEntity, capability::MoveEntityRequest,
};
use model_entity::{Entity, EntityType};
use projects_hex::domain::ports::ProjectContentCopier;

use super::{EntityLifecycleService, access_failure};

#[cfg(test)]
mod test;

/// The router's document, chat, access, and lifecycle services, acting for
/// the user who duplicates a folder.
pub(super) struct DssProjectContents<D, H, A, L> {
    pub(super) documents: Arc<D>,
    pub(super) chats: Arc<H>,
    pub(super) access: Arc<A>,
    pub(super) lifecycle: Arc<L>,
    pub(super) actor: EntityMutationActor,
}

/// A failed copy, carrying the copy when it was created but not filed.
struct CopyFailure {
    error: EntityMutationErrorCode,
    unfiled: Option<Entity<'static>>,
}

impl CopyFailure {
    fn not_created(error: EntityMutationErrorCode) -> Self {
        Self {
            error,
            unfiled: None,
        }
    }
}

/// Whether an access failure only means the user may not act on the entity.
fn denied(error: &AccessError) -> bool {
    match error {
        AccessError::Unauthorized
        | AccessError::UnauthorizedWithMessage(_)
        | AccessError::NotFound(_) => true,
        AccessError::BadRequest(_) | AccessError::Unavailable(_) | AccessError::Internal(_) => {
            false
        }
    }
}

impl<D, H, A, L> DssProjectContents<D, H, A, L>
where
    D: DuplicateEntity + MoveEntity + Send + Sync,
    H: DuplicateEntity + MoveEntity + DeleteEntityPermanently + Send + Sync,
    A: EntityAccessService,
    L: EntityLifecycleService,
{
    async fn receipt<T: RequiredPermission>(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.access
            .generate_entity_access_receipt::<T>(
                &self.actor.user_id,
                self.actor.organization_id,
                entity_id,
                entity_type,
            )
            .await
    }

    /// Duplicate through `service`, then move the copy into `project_id`.
    /// Duplication files a copy beside its source or at the root, so the
    /// move is what places it in the folder copy.
    async fn duplicate_into<S: DuplicateEntity + MoveEntity>(
        &self,
        service: &S,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        display_name: Option<String>,
        project_id: &str,
    ) -> Result<Entity<'static>, CopyFailure> {
        let source = receipt.entity().clone();
        let receipt = receipt
            .try_into_requirement::<<S as DuplicateEntity>::Receipt>()
            .map_err(|error| CopyFailure::not_created(access_failure(error)))?;
        let effects = service
            .duplicate_entity(
                source.entity_type.with_entity_string(source.entity_id),
                receipt,
                self.actor.user_id.clone(),
                display_name,
            )
            .await
            .map_err(CopyFailure::not_created)?;
        let copy = effects
            .into_iter()
            .find_map(|effect| match effect {
                EntityMutationEffect::Updated(entity)
                    if entity.entity_type == source.entity_type =>
                {
                    Some(entity)
                }
                EntityMutationEffect::Updated(_) | EntityMutationEffect::Deleted(_) => None,
            })
            .ok_or_else(|| {
                CopyFailure::not_created(EntityMutationErrorCode::internal(rootcause::report!(
                    "duplication reported no copy".to_string()
                )))
            })?;

        let filed = async {
            let receipt = self
                .receipt::<<S as MoveEntity>::Receipt>(&copy.entity_id, copy.entity_type)
                .await
                .map_err(access_failure)?;
            let project_receipt = self
                .receipt::<EditAccessLevel>(project_id, EntityType::Project)
                .await
                .map_err(access_failure)?;
            service
                .move_entity(MoveEntityRequest::MoveToProject {
                    entity: copy.clone(),
                    receipt,
                    project_id: project_id.to_string(),
                    project_receipt,
                })
                .await
        }
        .await;
        match filed {
            Ok(_) => Ok(copy),
            Err(error) => Err(CopyFailure {
                error,
                unfiled: Some(copy),
            }),
        }
    }

    async fn discard_document(&self, copy: &Entity<'static>) {
        let _ = self
            .lifecycle
            .delete_document_permanently(&self.actor, copy)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, entity_id = %copy.entity_id, "unable to discard unfiled document copy");
            });
    }

    async fn discard_chat(&self, copy: &Entity<'static>) {
        let deleted = match self
            .receipt::<<H as DeleteEntityPermanently>::Receipt>(&copy.entity_id, copy.entity_type)
            .await
        {
            Ok(receipt) => self
                .chats
                .delete_entity_permanently(copy.clone(), receipt)
                .await
                .map(drop),
            Err(error) => Err(access_failure(error)),
        };
        let _ = deleted.inspect_err(|error| {
            tracing::error!(error = ?error, entity_id = %copy.entity_id, "unable to discard unfiled chat copy");
        });
    }
}

impl<D, H, A, L> ProjectContentCopier for DssProjectContents<D, H, A, L>
where
    D: DuplicateEntity + MoveEntity + Send + Sync,
    H: DuplicateEntity + MoveEntity + DeleteEntityPermanently + Send + Sync,
    A: EntityAccessService,
    L: EntityLifecycleService,
{
    async fn view_receipt(
        &self,
        entity: &Entity<'static>,
    ) -> Result<Option<EntityAccessReceipt<ViewAccessLevel>>, EntityMutationErrorCode> {
        match self
            .receipt::<ViewAccessLevel>(&entity.entity_id, entity.entity_type)
            .await
        {
            Ok(receipt) => Ok(Some(receipt)),
            Err(error) if denied(&error) => Ok(None),
            Err(error) => Err(access_failure(error)),
        }
    }

    async fn can_add_to_project(&self, project_id: &str) -> Result<bool, EntityMutationErrorCode> {
        match self
            .receipt::<EditAccessLevel>(project_id, EntityType::Project)
            .await
        {
            Ok(_) => Ok(true),
            Err(error) if denied(&error) => Ok(false),
            Err(error) => Err(access_failure(error)),
        }
    }

    #[tracing::instrument(
        name = "project.duplicate.copy_item",
        skip_all,
        fields(
            entity_type = %receipt.entity().entity_type,
            entity_id = %receipt.entity().entity_id,
            project_id = %project_id,
            copy_id = tracing::field::Empty,
        ),
        err(Debug)
    )]
    async fn copy_into_project(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        name: String,
        project_id: &str,
    ) -> Result<Entity<'static>, EntityMutationErrorCode> {
        let copied = match receipt.entity().entity_type {
            EntityType::Document => {
                let copied = self
                    .duplicate_into(&*self.documents, receipt, Some(name), project_id)
                    .await;
                if let Err(CopyFailure {
                    unfiled: Some(copy),
                    ..
                }) = &copied
                {
                    self.discard_document(copy).await;
                }
                copied
            }
            // Chat duplication names its copy and accepts no chosen name.
            EntityType::Chat => {
                let copied = self
                    .duplicate_into(&*self.chats, receipt, None, project_id)
                    .await;
                if let Err(CopyFailure {
                    unfiled: Some(copy),
                    ..
                }) = &copied
                {
                    self.discard_chat(copy).await;
                }
                copied
            }
            entity_type => {
                return Err(EntityMutationErrorCode::unsupported(
                    rootcause::report!(entity_type).attach("copy into a project"),
                ));
            }
        };
        let copy = copied.map_err(|failure| failure.error)?;
        tracing::Span::current().record("copy_id", copy.entity_id.as_ref());
        Ok(copy)
    }
}
