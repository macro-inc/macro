use chrono::{DateTime, Utc};
use item_filters::CallStatus;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A Macro-account participant in a call record, as displayed in Soup.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCallRecordParticipant {
    /// The Macro user id.
    pub user_id: String,
    /// When the user joined the call.
    pub joined_at: DateTime<Utc>,
    /// When the user left (None if still in an active call).
    pub left_at: Option<DateTime<Utc>>,
}

/// A non-account guest of a call record, as displayed in Soup.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCallRecordGuest {
    /// Opaque guest identity; matches the guest's transcript speaker id.
    pub id: Uuid,
    /// Guest-provided display name.
    pub display_name: String,
    /// When the guest joined the call.
    pub joined_at: DateTime<Utc>,
    /// When the guest left (None if still in an active call).
    pub left_at: Option<DateTime<Utc>>,
}

/// A call record as displayed in Soup. Excludes room_name, egress_id,
/// and transcript — fields that are irrelevant for the soup feed.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCallRecord<T = ()> {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Option<Uuid>,
    /// User who created the call.
    pub created_by: String,
    /// When the call started.
    pub started_at: DateTime<Utc>,
    /// When the call ended (None if still active).
    pub ended_at: Option<DateTime<Utc>>,
    /// Call duration in milliseconds (None if still active).
    pub duration_ms: Option<i64>,
    /// Resolved display name for the channel.
    pub channel_name: Option<String>,
    /// User-supplied or AI-generated display name for the call.
    pub custom_name: Option<String>,
    /// AI-generated summary of the call. Only set on archived
    /// `call_records` once summarization has run; active calls always
    /// return `None`.
    pub summary: Option<String>,
    /// Whether the call is currently active.
    pub is_active: bool,
    /// Viewer-relative call status for the requesting user.
    pub status: CallStatus,
    /// Whether the requesting user attended this call. Kept for compatibility
    /// and derived from `status == ATTENDED`.
    pub attended: bool,
    /// Macro-account participants in the call.
    pub participants: Vec<SoupCallRecordParticipant>,
    /// Non-account guests in the call.
    pub guests: Vec<SoupCallRecordGuest>,
    /// Extra fields passed from above
    #[serde(flatten)]
    pub extra: T,
}
