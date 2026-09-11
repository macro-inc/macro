//! Explain how a user can reach an entity.

#[cfg(test)]
mod test;

use crate::domain::{
    models::{AccessError, AccessExplanation, Entity, EntityType},
    ports::{ExplainAccessRepository, ExplainAccessService},
};
use macro_user_id::{
    cowlike::CowLike, lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr,
};

/// Orchestrates labeled access explanations.
#[derive(Clone)]
pub struct ExplainAccessServiceImpl<R> {
    repo: R,
}

impl<R> ExplainAccessServiceImpl<R>
where
    R: ExplainAccessRepository,
{
    /// Create a new explain service.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> ExplainAccessService for ExplainAccessServiceImpl<R>
where
    R: ExplainAccessRepository,
{
    #[tracing::instrument(err, skip(self))]
    async fn explain_access(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<AccessExplanation, AccessError> {
        if !supports_explain(entity_type) {
            return Err(AccessError::BadRequest("Unsupported entity type"));
        }

        let grants = self
            .repo
            .list_access_grants(user_id, entity_id, entity_type)
            .await?;

        Ok(AccessExplanation::from_grants(
            MacroUserIdStr(user_id.clone().into_owned()),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            grants,
        ))
    }
}

fn supports_explain(entity_type: EntityType) -> bool {
    !matches!(
        entity_type,
        EntityType::User | EntityType::ChannelMessage | EntityType::Skill
    )
}
