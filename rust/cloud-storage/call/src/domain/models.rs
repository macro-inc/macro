//! Domain models for the call crate.

use std::fmt;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
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
    /// Egress (recording) ID, if recording is active.
    pub egress_id: Option<String>,
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
    /// The RTC server URL for the frontend SDK to connect to.
    pub server_url: String,
}

/// Response for the leave/end call operation.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct LeaveCallResponse {
    /// Whether the entire call was ended (room deleted).
    pub call_ended: bool,
}

/// Response indicating whether an active call exists for a channel.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallActiveResponse {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// User who created the call.
    pub created_by: String,
    /// When the call was created.
    pub created_at: DateTime<Utc>,
}

/// Configuration for S3 egress output.
#[derive(Clone)]
pub struct EgressS3Config {
    /// S3 bucket name.
    pub bucket: String,
    /// AWS region.
    pub region: String,
    /// AWS access key ID.
    pub access_key: String,
    /// AWS secret access key.
    pub secret: String,
}

impl fmt::Debug for EgressS3Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EgressS3Config")
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("access_key", &"<redacted>")
            .field("secret", &"<redacted>")
            .finish()
    }
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
    pub participant_identity: Option<MacroUserIdStr<'static>>,
    /// Egress ID associated with the event, if any.
    pub egress_id: Option<String>,
    /// File download URL from a completed egress, if any.
    pub file_url: Option<String>,
    /// Unix timestamp (seconds) when the event was created.
    pub created_at: i64,
}

/// A transcript segment from LiveKit Inference STT.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegmentRequest {
    /// LiveKit segment ID (used for deduplication across multiple submitters).
    pub segment_id: String,
    /// The speaker's user ID (from `lk.transcribed_track_id`).
    pub speaker_id: String,
    /// The transcribed text content.
    pub content: String,
    /// When the speaker started talking for this segment.
    pub started_at: DateTime<Utc>,
    /// When the speaker stopped talking for this segment.
    pub ended_at: Option<DateTime<Utc>>,
    /// Whether this is a final transcription (not interim).
    pub is_final: bool,
}

/// A transcript segment as returned in a [`CallRecord`].
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordTranscriptSegment {
    /// LiveKit segment ID (nullable for archived records).
    pub segment_id: Option<String>,
    /// The speaker's user ID.
    pub speaker_id: String,
    /// The transcribed text content.
    pub content: String,
    /// When the speaker started this segment.
    pub started_at: DateTime<Utc>,
    /// When the speaker stopped (if known).
    pub ended_at: Option<DateTime<Utc>>,
    /// Ordering within the call.
    pub sequence_num: i32,
}

/// A participant as returned in a [`CallRecord`] (historic — includes `left_at`).
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordParticipant {
    /// The user id.
    pub user_id: String,
    /// When the user joined the call.
    pub joined_at: DateTime<Utc>,
    /// When the user left (None if still in an active call).
    pub left_at: Option<DateTime<Utc>>,
}

/// Full record of a call, unifying rows from `calls` (active) and
/// `call_records` (archived) into a single response shape.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecord {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// The RTC room name.
    pub room_name: String,
    /// User who created the call.
    pub created_by: String,
    /// When the call started (created_at for active, started_at for archived).
    pub started_at: DateTime<Utc>,
    /// When the call ended (None if still active).
    pub ended_at: Option<DateTime<Utc>>,
    /// Call duration in milliseconds (None if still active).
    pub duration_ms: Option<i64>,
    /// Recording egress ID, if any.
    pub egress_id: Option<String>,
    /// Whether the call is currently active (from `calls` table).
    pub is_active: bool,
    /// Participants (both active and historic).
    pub participants: Vec<CallRecordParticipant>,
    /// Transcript segments ordered by `sequence_num`.
    pub transcript: Vec<CallRecordTranscriptSegment>,
}

/// Errors that can occur during call operations.
#[derive(Debug, thiserror::Error)]
pub enum CallError {
    /// No active call found for this channel.
    #[error("no active call found for channel {0}")]
    NotFound(String),
    /// User is not in the call.
    #[error("user not in call")]
    NotInCall,
    /// Authentication or signature validation failed.
    #[error("authentication failed")]
    Auth,
    /// An internal error occurred.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
