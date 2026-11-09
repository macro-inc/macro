//! Whether a person can open an idea's item, as the owning entity-access
//! service decides it.

use entity_access::domain::models::{AccessError, AccessLevel};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::Target;
use crate::domain::ports::IdeaAccess;

/// [`IdeaAccess`] through an [`EntityAccessService`].
pub struct EntityIdeaAccess<S>(pub S);

impl<S: EntityAccessService> IdeaAccess for EntityIdeaAccess<S> {
    type Err = AccessError;

    async fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> Result<bool, Self::Err> {
        match self
            .0
            .get_access_level(Some(user), &target.entity_id, target.entity_type)
            .await
        {
            Ok(level) => Ok(level.is_some_and(|level| level >= AccessLevel::View)),
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::BadRequest(_)
                | AccessError::NotFound(_),
            ) => Ok(false),
            // Never turn an outage into "no access": the caller retries.
            Err(error) => Err(error),
        }
    }
}
