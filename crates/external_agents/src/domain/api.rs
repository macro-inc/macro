//! An external agent's own API: reading its inbox and answering it.
//!
//! An event in the agent's inbox is the agent's authorization to answer it.
//! The reply goes where the event says, written with the current access of
//! the person who addressed the agent: one who can no longer write in that
//! conversation gets nothing from the agent either.

#[cfg(test)]
mod test;

use std::sync::Arc;

use bot_id::BotId;
use messages::domain::{
    api::MessageCommands,
    models::{MessageAttribution, PostMessage},
    ports::MessageError,
};
use uuid::Uuid;

use super::models::{AgentReply, ExternalAgentEvent, PostedReply};
use super::ports::{
    AgentWriteAccess, ExternalAgentApi, ExternalAgentError, ExternalAgentRepo, Result,
};

/// Most events one inbox read returns.
pub const MAX_EVENTS_PER_READ: u16 = 100;

/// Serves external agents' inbox reads, replies, and typing.
pub struct ExternalAgentApiService<R, A> {
    repo: R,
    access: A,
    messages: Arc<dyn MessageCommands>,
}

impl<R, A> ExternalAgentApiService<R, A> {
    /// Compose the inbox, write access, and message boundary.
    pub fn new(repo: R, access: A, messages: Arc<dyn MessageCommands>) -> Self {
        Self {
            repo,
            access,
            messages,
        }
    }
}

fn message_error(error: MessageError) -> ExternalAgentError {
    match error {
        MessageError::Invalid(message) => ExternalAgentError::BadRequest(message.to_owned()),
        MessageError::Conflict => ExternalAgentError::Conflict,
        MessageError::NotFound | MessageError::Forbidden => ExternalAgentError::NotFound,
        MessageError::Repository(error) => ExternalAgentError::Internal(error),
    }
}

impl<R: ExternalAgentRepo, A: AgentWriteAccess> ExternalAgentApiService<R, A> {
    /// The event and the agent's capability to answer it.
    async fn answerable(
        &self,
        bot_id: BotId,
        event_id: Uuid,
    ) -> Result<(
        ExternalAgentEvent,
        entity_access::domain::models::EntityAccessReceipt<messages::domain::service::MessageWrite>,
    )> {
        let event = self
            .repo
            .event(bot_id, event_id)
            .await?
            .ok_or(ExternalAgentError::NotFound)?;
        let access = self
            .access
            .bot_write(bot_id, event.invoking_user.clone(), &event.parent)
            .await?
            .ok_or(ExternalAgentError::NotFound)?;
        Ok((event, access))
    }
}

#[async_trait::async_trait]
impl<R: ExternalAgentRepo, A: AgentWriteAccess> ExternalAgentApi for ExternalAgentApiService<R, A> {
    #[tracing::instrument(skip(self), err)]
    async fn events(
        &self,
        bot_id: BotId,
        after: Option<Uuid>,
        limit: u16,
    ) -> Result<Vec<ExternalAgentEvent>> {
        self.repo
            .events(bot_id, after, limit.clamp(1, MAX_EVENTS_PER_READ))
            .await
    }

    #[tracing::instrument(skip(self, reply), fields(event_id = %reply.event_id), err)]
    async fn reply(&self, bot_id: BotId, reply: AgentReply) -> Result<PostedReply> {
        if reply.content.trim().is_empty() {
            return Err(ExternalAgentError::BadRequest(
                "text is required".to_owned(),
            ));
        }
        let (event, access) = self.answerable(bot_id, reply.event_id).await?;
        let message = self
            .messages
            .post(
                access,
                PostMessage {
                    attribution: MessageAttribution::ActingUser,
                    notification_policy: Default::default(),
                    id: reply.message_id,
                    content: reply.content,
                    thread_id: event.reply_thread_id,
                    anchor: None,
                    mentions: Vec::new(),
                    attachments: Vec::new(),
                    nonce: None,
                },
            )
            .await
            .map_err(message_error)?;
        Ok(PostedReply {
            message_id: message.id,
            parent: message.parent,
            thread_id: message.thread_id,
        })
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_typing(&self, bot_id: BotId, event_id: Uuid, active: bool) -> Result<()> {
        let (event, access) = self.answerable(bot_id, event_id).await?;
        self.messages
            .typing(access, event.reply_thread_id, active, None)
            .await
            .map_err(message_error)
    }
}
