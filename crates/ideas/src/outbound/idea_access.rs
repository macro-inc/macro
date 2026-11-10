//! Whether a person can open an idea's item, as the owning entity-access
//! service decides it, and whether a part named with it is one of its own.

use entity_access::domain::models::{AccessError, AccessLevel};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use sqlx::PgPool;

use crate::domain::model::Target;
use crate::domain::ports::IdeaAccess;

#[cfg(test)]
mod test;

/// Why an item can't be checked.
#[derive(Debug, thiserror::Error)]
pub enum ItemAccessError {
    /// The entity-access service failed.
    #[error(transparent)]
    Access(#[from] AccessError),
    /// Reading the item's parts failed.
    #[error(transparent)]
    Parts(#[from] sqlx::Error),
}

/// [`IdeaAccess`] through an [`EntityAccessService`], with parts read from
/// the items' own tables.
pub struct EntityIdeaAccess<S> {
    /// Decides access to the item.
    pub access: S,
    /// Reads which item a part belongs to.
    pub pool: PgPool,
}

impl<S: EntityAccessService> IdeaAccess for EntityIdeaAccess<S> {
    type Err = ItemAccessError;

    async fn can_view(
        &self,
        user: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> Result<bool, Self::Err> {
        match self
            .access
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
            Err(error) => Err(error.into()),
        }
    }

    async fn is_part_of(&self, target: &Target, part: &str) -> Result<bool, Self::Err> {
        Ok(part_of(&self.pool, target, part).await?)
    }
}

/// Whether `part` is a part of `target`'s item: a message of its channel or
/// of its email thread. Other items have no parts an idea can name.
pub(crate) async fn part_of(
    pool: &PgPool,
    target: &Target,
    part: &str,
) -> Result<bool, sqlx::Error> {
    let (Ok(part), Ok(item)) = (Uuid::parse_str(part), Uuid::parse_str(&target.entity_id)) else {
        return Ok(false);
    };
    match target.entity_type {
        EntityType::Channel => {
            sqlx::query_scalar!(
                r#"SELECT EXISTS (
                       SELECT 1 FROM comms_messages
                       WHERE id = $1 AND parent_entity_type = 'channel'
                         AND parent_entity_id = $2
                   ) AS "found!""#,
                part,
                item.to_string(),
            )
            .fetch_one(pool)
            .await
        }
        EntityType::EmailThread => {
            sqlx::query_scalar!(
                r#"SELECT EXISTS (
                       SELECT 1 FROM email_messages WHERE id = $1 AND thread_id = $2
                   ) AS "found!""#,
                part,
                item,
            )
            .fetch_one(pool)
            .await
        }
        _ => Ok(false),
    }
}
