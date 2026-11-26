//! Whether a person can open a suggestion's item, as the owning entity-access
//! service decides it, and whether a part named with it is one of its own.

use entity_access::domain::models::{AccessError, AccessLevel};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_entity::EntityType;
use sqlx::PgPool;

use crate::domain::model::Target;
use crate::domain::ports::SuggestionAccess;

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

/// [`SuggestionAccess`] through an [`EntityAccessService`], with parts read from
/// the items' own tables.
pub struct EntitySuggestionAccess<S> {
    /// Decides access to the item.
    pub access: S,
    /// Reads which item a part belongs to.
    pub pool: PgPool,
}

impl<S: EntityAccessService> SuggestionAccess for EntitySuggestionAccess<S> {
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

/// Whether `part` is a part of `target`'s item: a message of its channel that
/// wasn't deleted, or one of its email thread that the mailbox still holds.
/// Other items have no parts a suggestion can name. The `LIMIT 1` keeps each
/// lookup on the message's primary key: the plain filter may walk the channel.
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
                       SELECT 1 FROM (
                           SELECT parent_entity_type, parent_entity_id, deleted_at
                           FROM comms_messages WHERE id = $1 LIMIT 1
                       ) m
                       WHERE m.parent_entity_type = 'channel'
                         AND m.parent_entity_id = $2 AND m.deleted_at IS NULL
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
                       SELECT 1 FROM (
                           SELECT thread_id, mailbox_state
                           FROM email_messages WHERE id = $1 LIMIT 1
                       ) m
                       WHERE m.thread_id = $2
                         AND NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean, false)
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
