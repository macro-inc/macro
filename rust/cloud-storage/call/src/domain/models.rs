//! Domain models for the call crate.

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Represents an active call in a channel.
#[derive(Debug, Clone)]
pub struct Call {
    /// Unique call identifier.
    pub id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// Name of the RTC room (typically the channel_id as a string).
    pub room_name: String,
    /// User who created the call.
    pub created_by: String,
    /// When the call was created.
    pub created_at: DateTime<Utc>,
}

/// A participant in an active call.
#[derive(Debug, Clone)]
pub struct CallParticipant {
    /// The call this participant is in.
    pub call_id: Uuid,
    /// The user id.
    pub user_id: String,
    /// When the user joined the call.
    pub joined_at: DateTime<Utc>,
}

/// Response returned when creating or joining a call.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallTokenResponse {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call is associated with.
    pub channel_id: Uuid,
    /// The RTC token for connecting to the room.
    pub token: String,
    /// The RTC room name.
    pub room_name: String,
}

/// Response for the leave/end call operation.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct LeaveCallResponse {
    /// Whether the entire call was ended (room deleted).
    pub call_ended: bool,
}

/// A validated webhook event from the RTC provider.
#[derive(Debug, Clone)]
pub struct CallWebhookEvent {
    /// The event type (e.g. `room_started`, `room_finished`, `participant_joined`).
    pub event: String,
    /// Unique event identifier.
    pub id: String,
    /// Room name associated with the event, if any.
    pub room_name: Option<String>,
    /// Participant identity associated with the event, if any.
    pub participant_identity: Option<String>,
    /// Unix timestamp (seconds) when the event was created.
    pub created_at: i64,
}

/// Errors that can occur during call operations.
#[derive(Debug, thiserror::Error)]
pub enum CallError {
    /// A call already exists for this channel.
    #[error("call already exists for channel {0}")]
    AlreadyExists(String),
    /// No active call found for this channel.
    #[error("no active call found for channel {0}")]
    NotFound(String),
    /// User is already in the call.
    #[error("user already in call")]
    AlreadyJoined,
    /// User is not in the call.
    #[error("user not in call")]
    NotInCall,
    /// An internal error occurred.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
