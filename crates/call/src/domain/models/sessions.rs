//! The RTC sessions of one call.
//!
//! A call is usually one session: one RTC room from the first join until it
//! empties. A scheduled meeting that empties and is rejoined before its
//! scheduled end stays the same call, and each rejoin opens a later session in
//! a new room. The record's own columns describe the first session; each later
//! session is a `call_record_sessions` row.

use chrono::{DateTime, TimeDelta, Utc};

use super::CallRecord;

#[cfg(test)]
mod test;

/// One RTC session of an archived call: a time window and its recording.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordSession {
    /// When the session's room opened.
    pub started_at: DateTime<Utc>,
    /// When the session's room emptied.
    pub ended_at: DateTime<Utc>,
    /// When the session's recording began, once known. Anchor this session's
    /// transcript to it, falling back to `started_at`.
    pub recording_started_at: Option<DateTime<Utc>>,
    /// S3 object key for the session's recording (internal, not serialized).
    #[serde(skip_serializing)]
    pub recording_key: Option<String>,
    /// Stored S3 object key for the session's preview image (internal, not serialized).
    #[serde(skip_serializing)]
    pub preview_key: Option<String>,
    /// Presigned URL for the session's recording, if available.
    pub recording_url: Option<String>,
    /// Presigned URL for the session's preview image, if available.
    pub recording_preview_url: Option<String>,
}

impl CallRecord {
    /// Sets `sessions` on an archived record from its later sessions (the
    /// `call_record_sessions` rows, in order). A live or imported record has
    /// no `ended_at` or no room, and keeps no sessions.
    ///
    /// The first session's end is not stored. The record's `duration_ms` is
    /// the sum of every session's length, so the first session lasted what is
    /// left after the later ones; it is clamped to the record's own window.
    pub fn set_archived_sessions(&mut self, later: Vec<CallRecordSession>) {
        let (Some(ended_at), Some(_)) = (self.ended_at, &self.room_name) else {
            return;
        };
        let later_ms: i64 = later
            .iter()
            .map(|session| session_length(session).num_milliseconds())
            .sum();
        let first_ms = self.duration_ms.unwrap_or_default() - later_ms;
        let first_ended_at =
            (self.started_at + TimeDelta::milliseconds(first_ms.max(0))).min(ended_at);

        let first = CallRecordSession {
            started_at: self.started_at,
            ended_at: first_ended_at,
            recording_started_at: self.recording_started_at,
            recording_key: self.recording_key.clone(),
            preview_key: self.preview_key.clone(),
            recording_url: None,
            recording_preview_url: None,
        };
        self.sessions = std::iter::once(first).chain(later).collect();
    }
}

/// How long a session lasted, counted the way archival adds it to the call's
/// duration.
fn session_length(session: &CallRecordSession) -> TimeDelta {
    (session.ended_at - session.started_at).max(TimeDelta::zero())
}
