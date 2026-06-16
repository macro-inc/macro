use model::comms;
use serde::{Deserialize, Serialize};

pub use comms::{
    Channel, ChannelId, ChannelMessage, ChannelParticipant, ChannelType, ChannelWithParticipants,
    LatestMessage, OrganizationId, ParticipantRole,
};

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupChannel {
    #[serde(flatten)]
    pub channel: ChannelWithParticipants,
    #[serde(flatten)]
    pub latest_message: LatestMessage,
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub interacted_at: Option<chrono::DateTime<chrono::Utc>>,
}
