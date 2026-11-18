//! Request-to-join-a-channel notification projection.

use super::GraphqlChannelNotificationCommon;
use async_graphql::{ID, Object};
use model_notifications::ChannelAccessRequestedMetadata;

/// GraphQL wrapper for a request to join a channel.
pub struct GraphqlChannelAccessRequestedMetadata(pub(super) ChannelAccessRequestedMetadata);

/// Metadata for someone asking to join a channel the recipient participates in.
#[Object]
impl GraphqlChannelAccessRequestedMetadata {
    /// The attempt to join; its current outcome is served by the channel.
    async fn request_id(&self) -> ID {
        ID(self.0.request_id.to_string())
    }

    /// Channel metadata.
    #[graphql(flatten)]
    async fn channel(&self) -> GraphqlChannelNotificationCommon {
        GraphqlChannelNotificationCommon(self.0.common.clone())
    }

    /// Requester profile-picture URL.
    async fn sender_profile_picture_url(&self) -> Option<&str> {
        self.0.sender_profile_picture_url.as_deref()
    }
}
