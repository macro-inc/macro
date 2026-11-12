//! [`LinkAccess`] over the shared entity access service.

#[cfg(test)]
mod test;

use entity_access::domain::models::AccessError;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use crate::manual::LinkAccess;

/// Answers "can this user view this entity" with the same checks every
/// entity's own endpoints use.
pub(crate) struct EntityAccessLinks<Access>(pub Access);

impl<Access: EntityAccessService> LinkAccess for EntityAccessLinks<Access> {
    async fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        entity: &Entity<'_>,
    ) -> Result<bool, rootcause::Report> {
        let level = self
            .0
            .get_access_level(Some(&user.0), &entity.entity_id, entity.entity_type)
            .await;
        can_view_from(level.map(|level| level.is_some()))
    }
}

/// Every access level includes viewing. A malformed id, a missing entity or a
/// refusal all mean the user cannot see it; only a failed check is an error.
fn can_view_from(has_access: Result<bool, AccessError>) -> Result<bool, rootcause::Report> {
    match has_access {
        Ok(has_access) => Ok(has_access),
        Err(
            AccessError::BadRequest(_)
            | AccessError::NotFound(_)
            | AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_),
        ) => Ok(false),
        Err(error) => Err(rootcause::Report::new(error).into_dynamic()),
    }
}
