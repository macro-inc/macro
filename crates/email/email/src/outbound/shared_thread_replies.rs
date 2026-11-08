//! Shared-thread reply access backed by MacroDB and the entity-access service.

use entity_access::domain::{
    models::{AccessError, EditAccessLevel},
    ports::EntityAccessService,
};
use entity_kind::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{
    models::EmailErr,
    shared_thread_replies::{ReplyTargetInboxFuture, SharedThreadReplyAccess},
};

/// Resolves a message's thread and grants a reply when the caller can edit it.
pub struct EntityAccessSharedThreadReplies<A> {
    pool: PgPool,
    access: A,
}

impl<A> EntityAccessSharedThreadReplies<A> {
    /// Create the adapter from the composition root's pool and access service.
    pub fn new(pool: PgPool, access: A) -> Self {
        Self { pool, access }
    }
}

impl<A: EntityAccessService + 'static> SharedThreadReplyAccess
    for EntityAccessSharedThreadReplies<A>
{
    fn reply_target_inbox<'a>(
        &'a self,
        actor: &'a MacroUserIdStr<'static>,
        message_id: Uuid,
    ) -> ReplyTargetInboxFuture<'a> {
        Box::pin(async move {
            let Some(message) = sqlx::query!(
                "SELECT link_id, thread_id FROM email_messages WHERE id = $1",
                message_id
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(anyhow::Error::from)?
            else {
                return Ok(None);
            };

            match self
                .access
                .generate_entity_access_receipt::<EditAccessLevel>(
                    actor,
                    None,
                    &message.thread_id.to_string(),
                    EntityType::EmailThread,
                )
                .await
            {
                Ok(_) => Ok(Some(message.link_id)),
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => Ok(None),
                Err(error) => Err(EmailErr::RepoErr(anyhow::anyhow!(
                    "shared thread reply access check failed: {error}"
                ))),
            }
        })
    }
}
