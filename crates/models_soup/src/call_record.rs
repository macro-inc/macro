use call::domain::models::{CallRecord, CallRecordParticipant};
use chrono::{DateTime, Utc};
use item_filters::CallStatus;
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
    /// Participants in the call.
    pub participants: Vec<SoupCallRecordParticipant>,
}

fn participant_derived_status(participants: &[CallRecordParticipant], user_id: &str) -> CallStatus {
    if participants.iter().any(|p| p.user_id == user_id) {
        return CallStatus::Attended;
    }

    CallStatus::Unattended
}

impl SoupCallRecord {
    /// Build a `SoupCallRecord` from a domain `CallRecord` in the context of a
    /// specific viewer.
    pub fn from_record_for_user(record: CallRecord, user_id: &str) -> Self {
        let status = record
            .status
            .unwrap_or_else(|| participant_derived_status(&record.participants, user_id));
        let attended = status == CallStatus::Attended;

        SoupCallRecord {
            call_id: record.call_id,
            channel_id: record.channel_id,
            created_by: record.created_by,
            started_at: record.started_at,
            ended_at: record.ended_at,
            duration_ms: record.duration_ms,
            channel_name: record.channel_name,
            custom_name: record.custom_name,
            summary: record.summary,
            is_active: record.is_active,
            status,
            attended,
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

#[cfg(test)]
mod test;
