//! Object-safe adapter over the channel service for posting bot messages and
//! reading local channel context.

use async_trait::async_trait;
use channels::domain::models::{
    ChannelContextMessage, ParticipantRole, PatchMessageRequest, PostMessageRequest,
    PostMessageResponse, Sender,
};
use channels::domain::ports::ChannelService;
use uuid::Uuid;

/// A channel message used to give a bot conversational context.
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
/// and reading local context. Implemented by any [`ChannelService`].
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

    /// Fetch channel messages around `message_id`, oldest-first.
    async fn messages_around(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
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

    async fn messages_around(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> anyhow::Result<Vec<ContextMessage>> {
        let messages =
            ChannelService::get_message_context(self, channel_id, message_id, before, after)
                .await
                .map_err(anyhow::Error::new)?;

        Ok(messages
            .into_iter()
            .filter(|message| message.deleted_at.is_none())
            .map(|message: ChannelContextMessage| ContextMessage {
                id: message.id,
                sender_id: message.sender_id,
                content: message.content,
            })
            .collect())
    }
}
