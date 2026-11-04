//! [`LinkAccess`] over the shared entity access service.

use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;

use super::LinkAccess;

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
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;

        // Every access level includes viewing.
        Ok(level.is_some())
    }
}
