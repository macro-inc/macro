//! Object-safe adapter over the channel service for posting bot messages.

use async_trait::async_trait;
use channels::domain::models::{
    ParticipantRole, PatchMessageRequest, PostMessageRequest, PostMessageResponse, Sender,
};
use channels::domain::ports::ChannelService;
use uuid::Uuid;

/// Minimal, object-safe interface for posting and editing channel messages as a
/// bot. Implemented by any [`ChannelService`].
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
}
