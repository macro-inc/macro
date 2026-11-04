//! Agents' write capability, minted by entity access.

use std::sync::Arc;

use bot_id::BotId;
use entity_access::domain::{
    models::{AccessError, BotAccessScope, EntityAccessReceipt},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{models::MessageParent, service::MessageWrite};

use crate::domain::ports::{AgentWriteAccess, ExternalAgentError, Result};

/// [`AgentWriteAccess`] over the entity access service.
pub struct EntityAccessAgentWrites<A>(pub Arc<A>);

impl<A: EntityAccessService> AgentWriteAccess for EntityAccessAgentWrites<A> {
    async fn bot_write(
        &self,
        bot_id: BotId,
        user: MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<Option<EntityAccessReceipt<MessageWrite>>> {
        match self
            .0
            .generate_bot_entity_access_receipt::<MessageWrite>(
                bot_id,
                BotAccessScope::user(user),
                &parent.entity_id(),
                parent.access_entity_type(),
            )
            .await
        {
            Ok(receipt) => Ok(Some(receipt)),
            Err(AccessError::Unavailable(error) | AccessError::Internal(error)) => {
                Err(ExternalAgentError::Internal(error))
            }
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::BadRequest(_)
                | AccessError::NotFound(_),
            ) => Ok(None),
        }
    }
}
