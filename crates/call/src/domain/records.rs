//! Provider-independent, durable call records. Native RTC sessions are optional.
//!
//! All resources share the existing `call` entity ID and its permissions. A
//! participant, recording, transcript, collab surface, or discussion is optional.
//! Native runtime/archive resources continue to use the existing storage tables.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A nonempty, opaque provider identifier, preserved verbatim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ExternalCallId(String);

impl TryFrom<String> for ExternalCallId {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() {
            return Err("external call identifiers cannot be empty");
        }
        Ok(Self(value))
    }
}

impl From<ExternalCallId> for String {
    fn from(value: ExternalCallId) -> Self {
        value.0
    }
}

impl AsRef<str> for ExternalCallId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

/// How the entity was originally created; independent of its media and sources.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallCreatedVia {
    /// A Macro RTC session.
    Native,
    /// An integration supplied the record.
    Import,
    /// A user supplied a recording.
    Upload,
    /// A user entered the record manually.
    Manual,
}

/// Supported call and transcript providers. Add variants as integrations grow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallProvider {
    /// A Macro-native call or transcript.
    Macro,
    /// A call or transcript imported from Granola.
    Granola,
}

/// Durable product identity, independent of any room or provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallEntity {
    /// Stable Macro entity ID, preserved when a native call is archived.
    pub id: Uuid,
    /// Macro owner, independent of any external organizer.
    pub user_id: MacroUserIdStr<'static>,
    /// User-visible title, when known.
    pub title: Option<String>,
    /// Original creation mechanism.
    pub created_via: CallCreatedVia,
    /// Actual start; an import must not substitute its creation time.
    pub started_at: Option<DateTime<Utc>>,
    /// Actual end, independently optional.
    pub ended_at: Option<DateTime<Utc>>,
    /// Conversation duration, independent of a recording's length.
    pub duration_ms: Option<i64>,
    /// Optional Macro channel association.
    pub channel_id: Option<Uuid>,
    /// Optional reusable Macro meeting invitation.
    pub meeting_id: Option<Uuid>,
    /// Creation time in Macro, usable for ordering when timing is unknown.
    pub created_at: DateTime<Utc>,
    /// Last metadata modification in Macro.
    pub updated_at: DateTime<Utc>,
}

/// External object identity. The full tuple is the database uniqueness key.
///
/// The importer supplies an authenticated user and an authorized stable account
/// namespace; provider IDs, titles, or meeting URLs alone are not deduplication keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallSource {
    /// User whose integration supplied the object; this is not an access grant.
    pub user_id: MacroUserIdStr<'static>,
    /// Stable provider-account namespace, retained across credential rotation.
    pub namespace: String,
    /// Provider that supplied the source object.
    pub provider: CallProvider,
    /// Provider object category, such as `note` or `meeting`.
    pub object_type: String,
    /// Opaque provider identifier, not necessarily a UUID.
    pub external_id: ExternalCallId,
    /// Stable source permalink, if supplied.
    pub external_url: Option<String>,
    /// Provider revision time, distinct from call timing.
    pub external_updated_at: Option<DateTime<Utc>>,
    /// Most recent successful synchronization.
    pub synced_at: Option<DateTime<Utc>>,
    /// Provider-specific facts, never credentials.
    #[serde(default)]
    pub metadata: serde_json::Map<String, serde_json::Value>,
}

/// A call-local participant or speaker; identification and attendance are optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallParticipant {
    /// Call-local identity; never use an email address as a primary key.
    pub id: Uuid,
    /// Resolved Macro account, if any. Does not confer access.
    pub user_id: Option<MacroUserIdStr<'static>>,
    /// Display name when supplied.
    pub display_name: Option<String>,
    /// Provider-supplied email address, not proof of identity.
    pub email: Option<String>,
    /// Telephone number when supplied.
    pub phone: Option<String>,
    /// Opaque participant identifier from the source.
    pub external_id: Option<ExternalCallId>,
    /// Known attendance intervals; empty does not mean absent.
    #[serde(default)]
    pub attendance: Vec<CallAttendance>,
}

/// One known attendance interval. Rejoining creates another interval.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallAttendance {
    /// Stable interval ID.
    pub id: Uuid,
    /// Join instant, if known.
    pub joined_at: Option<DateTime<Utc>>,
    /// Leave instant, if known.
    pub left_at: Option<DateTime<Utc>>,
}

/// Media actually stored, independent of the medium used for the conversation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallMediaType {
    /// Audio-only media.
    Audio,
    /// Video media, potentially with audio.
    Video,
}

/// A stable media locator. Playback URLs must be resolved separately.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum CallRecordingLocation {
    /// Macro-managed object storage key, not a signed URL.
    StorageKey(String),
    /// External provider URL; never implies public access to the media.
    ExternalUrl(String),
}

/// One of potentially many recordings of a call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallRecording {
    /// Stable recording ID.
    pub id: Uuid,
    /// Recorded media type.
    pub media_type: CallMediaType,
    /// Stable media reference.
    pub location: CallRecordingLocation,
    /// Optional MIME type.
    pub mime_type: Option<String>,
    /// Media duration, distinct from call duration.
    pub duration_ms: Option<i64>,
    /// Actual media start, if known.
    pub started_at: Option<DateTime<Utc>>,
}

/// A transcript version or language, with or without a recording.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallTranscript {
    /// Stable transcript ID.
    pub id: Uuid,
    /// Optional recording in the same call.
    pub recording_id: Option<Uuid>,
    /// Language tag, if known.
    pub language: Option<String>,
    /// Provider that supplied the transcript, independently of the call's source.
    pub provider: Option<CallProvider>,
    /// Optional absolute origin for transcript offsets.
    pub started_at: Option<DateTime<Utc>>,
    /// Ordered content; missing timing and speaker information remain absent.
    #[serde(default)]
    pub segments: Vec<CallTranscriptSegment>,
}

/// One ordered text segment. Text-only imports need no fabricated timestamps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallTranscriptSegment {
    /// Stable ordering within a transcript, independent of timing.
    pub sequence_num: i32,
    /// Resolved speaker in the same call, when known.
    pub participant_id: Option<Uuid>,
    /// Original provider speaker label, even if no person can be resolved.
    pub speaker_label: Option<String>,
    /// Transcript text.
    pub content: String,
    /// Milliseconds relative to the transcript origin, when known.
    pub start_ms: Option<i64>,
    /// End offset relative to the same origin, when known.
    pub end_ms: Option<i64>,
}

/// Saved view of a call and its optional imported resources.
///
/// Discussions and collaborative notes use the existing call parent ID through
/// comms and collab surfaces; neither requires a placeholder child here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallEntityRecord {
    /// Durable identity and optional occurrence metadata.
    pub entity: CallEntity,
    /// External object bindings; several providers may describe the same call.
    #[serde(default)]
    pub sources: Vec<CallSource>,
    /// Known participants and speakers.
    #[serde(default)]
    pub participants: Vec<CallParticipant>,
    /// Available audio and/or video recordings.
    #[serde(default)]
    pub recordings: Vec<CallRecording>,
    /// Available transcripts, independently optional.
    #[serde(default)]
    pub transcripts: Vec<CallTranscript>,
}
