//! Unified entity-mutation capability impls for email threads.

use std::collections::HashSet;

use entity_access::domain::models::EditAccessLevel;
use entity_mutation::{
    EntityMutationEffect, EntityMutationErrorCode, MoveEntity, capability::MoveEntityRequest,
};
use model_entity::{Entity, EntityType};

use super::EmailServiceImpl;
use crate::domain::{models::EmailErr, ports::EmailService};

impl From<EmailErr> for EntityMutationErrorCode {
    fn from(error: EmailErr) -> Self {
        match error {
            error @ EmailErr::ThreadNotFound => Self::not_found(rootcause::report!(error)),
            error @ EmailErr::Unauthorized => Self::forbidden(rootcause::report!(error)),
            error => Self::internal(rootcause::report!(error)),
        }
    }
}

/// Build affected project entities from optional container ids.
fn project_refs(ids: impl IntoIterator<Item = Option<String>>) -> Vec<Entity<'static>> {
    let mut seen = HashSet::new();
    ids.into_iter()
        .flatten()
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .map(|id| EntityType::Project.with_entity_string(id))
        .collect()
}

impl<T, U, E, CS, Eam, B> MoveEntity for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    Self: EmailService,
{
    type Receipt = EditAccessLevel;

    async fn move_entity(
        &self,
        request: MoveEntityRequest<Self::Receipt>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let (entity, receipt, project_id, project_receipt) = match request {
            MoveEntityRequest::MoveToRoot { entity, receipt } => (entity, receipt, None, None),
            MoveEntityRequest::MoveToProject {
                entity,
                receipt,
                project_id,
                project_receipt,
            } => (entity, receipt, Some(project_id), Some(project_receipt)),
        };
        let old_project_id = self.update_thread_project(receipt, project_receipt).await?;
        Ok(std::iter::once(EntityMutationEffect::updated(entity))
            .chain(
                project_refs([old_project_id, project_id])
                    .into_iter()
                    .map(EntityMutationEffect::updated),
            )
            .collect())
    }
}
