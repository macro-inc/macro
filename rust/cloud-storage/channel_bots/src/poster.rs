//! Object-safe adapter over the channel service for posting bot messages and
//! reading recent context.

use async_trait::async_trait;
use channels::domain::models::{
    ChannelMessageFilters, MessagePageDirection, ParticipantRole, PatchMessageRequest,
    PostMessageRequest, PostMessageResponse, Sender,
};
use channels::domain::ports::ChannelService;
use models_pagination::{CreatedAt, Query};
use uuid::Uuid;

/// A prior channel message used to give a bot conversational context.
#[derive(Debug, Clone)]
pub struct ContextMessage {
    /// Message id.
    pub id: Uuid,
    /// Sender storage id (e.g. `macro|<email>` or `bot|<uuid>`).
    pub sender_id: String,
    /// Message body.
    pub content: String,
}

/// Minimal, object-safe interface for posting/editing channel messages as a bot
/// and reading recent context. Implemented by any [`ChannelService`].
#[async_trait]
pub trait ChannelBotPoster: Send + Sync {
    /// Post a message to a channel as `actor`.
    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> anyhow::Result<PostMessageResponse>;

    /// Edit an existing message in a channel as `actor`.
    async fn patch_message(
        &self,
        actor: Sender,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        req: PatchMessageRequest,
    ) -> anyhow::Result<()>;

    /// Fetch the most recent top-level messages in a channel, oldest-first.
    async fn recent_messages(
        &self,
        channel_id: Uuid,
        limit: u16,
    ) -> anyhow::Result<Vec<ContextMessage>>;

    /// Fetch the replies in a thread, oldest-first.
    async fn thread_messages(
        &self,
        channel_id: Uuid,
        thread_id: Uuid,
    ) -> anyhow::Result<Vec<ContextMessage>>;
}

#[async_trait]
impl<T: ChannelService> ChannelBotPoster for T {
    async fn post_message(
        &self,
        actor: Sender,
        channel_id: Uuid,
        req: PostMessageRequest,
    ) -> anyhow::Result<PostMessageResponse> {
        ChannelService::post_message(self, actor, channel_id, req)
            .await
            .map_err(anyhow::Error::new)
    }

    async fn patch_message(
        &self,
        actor: Sender,
        actor_role: ParticipantRole,
        channel_id: Uuid,
        message_id: Uuid,
        req: PatchMessageRequest,
    ) -> anyhow::Result<()> {
        ChannelService::patch_message(self, actor, actor_role, channel_id, message_id, req)
            .await
            .map_err(anyhow::Error::new)
    }

    async fn recent_messages(
        &self,
        channel_id: Uuid,
        limit: u16,
    ) -> anyhow::Result<Vec<ContextMessage>> {
        let result = ChannelService::get_channel_messages(
            self,
            channel_id,
            Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            limit,
            &ChannelMessageFilters::default(),
            None,
        )
        .await
        .map_err(anyhow::Error::new)?;

        // The page is newest-first; present it oldest-first for reading.
        let mut messages: Vec<ContextMessage> = result
            .page
            .items
            .into_iter()
            .map(|message| ContextMessage {
                id: message.id,
                sender_id: message.sender_id,
                content: message.content,
            })
            .collect();
        messages.reverse();
        Ok(messages)
    }

    async fn thread_messages(
        &self,
        channel_id: Uuid,
        thread_id: Uuid,
    ) -> anyhow::Result<Vec<ContextMessage>> {
        let replies = ChannelService::get_thread_replies(self, channel_id, thread_id)
            .await
            .map_err(anyhow::Error::new)?;
        Ok(replies
            .into_iter()
            .map(|reply| ContextMessage {
                id: reply.id,
                sender_id: reply.sender_id,
                content: reply.content,
            })
            .collect())
    }
}
