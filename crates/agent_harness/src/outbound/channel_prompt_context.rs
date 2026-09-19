//! Loads authorized channel history for managed agent prompts.

#[cfg(test)]
mod test;

use std::sync::Arc;

use channels::domain::models::ChannelContextMessage;
use channels::domain::ports::ChannelService;
use entity_access::domain::models::{EntityType, MemberParticipantRole};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::PriorChannelMessage;
use crate::domain::ports::ChannelPromptContext;

const CONTEXT_MESSAGE_LIMIT: usize = 10;

trait ChannelContextSource: Send + Sync + 'static {
    fn message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
    ) -> impl Future<Output = Result<Vec<ChannelContextMessage>>> + Send;
}

impl<Channels> ChannelContextSource for Channels
where
    Channels: ChannelService + Send + Sync + 'static,
{
    async fn message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
    ) -> Result<Vec<ChannelContextMessage>> {
        self.get_message_context(channel_id, message_id, before, 0)
            .await
            .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))
    }
}

trait ChannelContextAuthorizer: Send + Sync + 'static {
    fn authorize_member(
        &self,
        actor: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> impl Future<Output = Result<()>> + Send;
}

impl<Access> ChannelContextAuthorizer for Access
where
    Access: EntityAccessService,
{
    async fn authorize_member(
        &self,
        actor: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<()> {
        self.generate_entity_access_receipt::<MemberParticipantRole>(
            actor,
            None,
            &channel_id.to_string(),
            EntityType::Channel,
        )
        .await
        .map(|_| ())
        .map_err(|error| HarnessError::PromptContext(rootcause::report!(error).into()))
    }
}

/// Channel context adapter that rechecks the triggering user's membership.
pub struct ChannelPromptContextAdapter<Channels, Access> {
    channels: Arc<Channels>,
    access: Arc<Access>,
}

impl<Channels, Access> ChannelPromptContextAdapter<Channels, Access> {
    /// Build an adapter from the channels and entity-access services.
    pub fn new(channels: Arc<Channels>, access: Arc<Access>) -> Self {
        Self { channels, access }
    }
}

impl<Channels, Access> ChannelPromptContext for ChannelPromptContextAdapter<Channels, Access>
where
    Channels: ChannelContextSource,
    Access: ChannelContextAuthorizer,
{
    async fn authorize_member(
        &self,
        actor: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<()> {
        self.access.authorize_member(actor, channel_id).await
    }

    async fn preceding_messages(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<Vec<PriorChannelMessage>> {
        let mut before = CONTEXT_MESSAGE_LIMIT;
        loop {
            let messages = self
                .channels
                .message_context(channel_id, message_id, before as i64)
                .await?;
            let reached_channel_start = messages.len() < before + 1;
            let mut live = messages
                .into_iter()
                .filter(|message| message.id != message_id && message.deleted_at.is_none())
                .map(|message| PriorChannelMessage {
                    sender: message.sender_id,
                    content: message.content,
                })
                .collect::<Vec<_>>();

            if live.len() >= CONTEXT_MESSAGE_LIMIT {
                return Ok(live.split_off(live.len() - CONTEXT_MESSAGE_LIMIT));
            }
            if reached_channel_start {
                return Ok(live);
            }
            before = before.saturating_mul(2).min(i64::MAX as usize);
        }
    }
}
