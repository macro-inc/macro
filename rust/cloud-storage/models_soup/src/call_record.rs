use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A participant in a call record, as displayed in Soup.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCallRecordParticipant {
    /// The user id.
    pub user_id: String,
    /// When the user joined the call.
    pub joined_at: DateTime<Utc>,
    /// When the user left (None if still in an active call).
    pub left_at: Option<DateTime<Utc>>,
}

/// A call record as displayed in Soup. Excludes room_name, egress_id,
/// and transcript — fields that are irrelevant for the soup feed.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCallRecord {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
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
    /// Whether the call is currently active.
    pub is_active: bool,
    /// Participants in the call.
    pub participants: Vec<SoupCallRecordParticipant>,
}

impl From<call::domain::models::CallRecord> for SoupCallRecord {
    fn from(record: call::domain::models::CallRecord) -> Self {
        SoupCallRecord {
            call_id: record.call_id,
            channel_id: record.channel_id,
            created_by: record.created_by,
            started_at: record.started_at,
            ended_at: record.ended_at,
            duration_ms: record.duration_ms,
            channel_name: record.channel_name,
            is_active: record.is_active,
            participants: record
                .participants
                .into_iter()
                .map(|p| SoupCallRecordParticipant {
                    user_id: p.user_id,
                    joined_at: p.joined_at,
                    left_at: p.left_at,
                })
                .collect(),
        }
    }
}
