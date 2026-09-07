//! Authorized conversation history through the common read application boundary.

#[cfg(test)]
mod test;

use crate::domain::{
    service::{AuthorizedInvocation, ThreadHistory},
    thread_window::ThreadMessage,
};
use agent_session::domain::error::{AgentSessionError, Result};
use entity_access::domain::{
    models::{AccessError, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use messages::domain::{
    api::MessageReader, models::MessageParent, ports::MessageError, service::MessageWrite,
};
use std::sync::Arc;

trait InvocationAuthorizer: Send + Sync + 'static {
    fn capability(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> impl Future<Output = std::result::Result<EntityAccessReceipt<MessageWrite>, AccessError>> + Send;
}

impl<Access: EntityAccessService> InvocationAuthorizer for Access {
    async fn capability(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> std::result::Result<EntityAccessReceipt<MessageWrite>, AccessError> {
        self.generate_entity_access_receipt::<MessageWrite>(
            user,
            None,
            &parent.entity_id(),
            match parent {
                MessageParent::Channel(_) => EntityType::Channel,
                MessageParent::Document(_) => EntityType::Document,
            },
        )
        .await
    }
}

/// Reads common message history with the invoking user's current capability.
pub struct MessageThreadHistory<Access> {
    messages: Arc<dyn MessageReader>,
    access: Access,
}

impl<Access> MessageThreadHistory<Access> {
    /// Compose the read application port and current parent authorization.
    pub fn new(messages: Arc<dyn MessageReader>, access: Access) -> Self {
        Self { messages, access }
    }
}

impl<Access: InvocationAuthorizer> ThreadHistory for MessageThreadHistory<Access> {
    async fn authorize_invocation(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
        root_id: Uuid,
    ) -> Result<Option<AuthorizedInvocation>> {
        match self.access.capability(user, parent).await {
            Ok(access) => Ok(Some(AuthorizedInvocation { access, root_id })),
            Err(AccessError::Unavailable(error) | AccessError::Internal(error)) => {
                Err(AgentSessionError::Unknown(error.into()))
            }
            Err(_) => Ok(None),
        }
    }

    async fn thread_messages(
        &self,
        invocation: &AuthorizedInvocation,
    ) -> Result<Vec<ThreadMessage>> {
        let access = invocation
            .access
            .clone()
            .try_into_requirement()
            .map_err(|error| AgentSessionError::Unknown(error.into()))?;
        let thread = match self.messages.get_thread(access, invocation.root_id).await {
            Ok(thread) => thread,
            Err(MessageError::NotFound) => return Ok(Vec::new()),
            Err(error) => return Err(AgentSessionError::Unknown(error.into())),
        };
        Ok(std::iter::once(thread.root)
            .chain(thread.replies)
            .filter(|message| message.deleted_at.is_none())
            .map(|message| ThreadMessage {
                id: message.id,
                sender: message.sender_id,
                content: message.content,
                created_at: message.created_at,
            })
            .collect())
    }
}
