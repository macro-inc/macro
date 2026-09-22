//! Email-owned, immutable scheduling snapshots. These are never calendar sources.

use serde::{Deserialize, Serialize};

/// Version of the normalized snapshot format and extraction policy.
pub const INVITATION_PARSER_VERSION: u16 = 1;

/// Extraction lifecycle, independent from calendar connectivity.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub enum InvitationExtractionStatus {
    /// Historical message whose MIME has not been inspected.
    #[default]
    Unprocessed,
    /// At least one attachment is awaiting a durable retry.
    Pending,
    /// One or more scheduling components were saved.
    Ready,
    /// MIME was inspected and contained no scheduling components.
    Absent,
    /// Calendar content could not be rendered safely.
    Unsupported,
}

/// Saved invitation data accompanying an email through every transport.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct MessageCalendarInvitations {
    /// Whether extraction ran and whether it needs retrying.
    pub status: InvitationExtractionStatus,
    /// Distinct scheduling components, including recurrence overrides.
    pub invitations: Vec<CalendarInvitation>,
}

/// Original scheduling method, including methods unsupported for actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub enum InvitationMethod {
    /// Initial invitation or scheduling update.
    Request,
    /// Participation notification.
    Reply,
    /// Series or occurrence cancellation.
    Cancel,
    /// Proposed time; there is no approve action.
    Counter,
    /// Published event without an invitation request.
    Publish,
    /// Missing or unrecognized scheduling method.
    Unknown,
}

/// Preserve date-only and unresolved times without manufacturing UTC instants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub enum InvitationDateTime {
    /// Calendar date. DTEND remains exclusive.
    Date {
        /// ISO calendar date.
        value: String,
    },
    /// Unambiguous instant with the original timezone retained.
    Zoned {
        /// RFC3339 instant.
        value: String,
        /// Original TZID, or UTC.
        time_zone: String,
        /// Original local wall time.
        local: String,
    },
    /// Floating, ambiguous, nonexistent, or unknown-zone wall time.
    Unresolved {
        /// ISO local wall time, without an offset.
        value: String,
        /// Original TZID if present.
        time_zone: Option<String>,
    },
}

/// Scheduling participant; saved responses are historical, not current RSVP.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct InvitationParticipant {
    /// Participant calendar address.
    pub email: String,
    /// Sender-supplied display name.
    pub name: Option<String>,
    /// Original PARTSTAT, retaining extensions.
    pub participation_status: Option<String>,
    /// Original ROLE, including optional and non-participants.
    pub role: Option<String>,
    /// Original CUTYPE, including resources and rooms.
    pub kind: Option<String>,
}

/// Display snapshot of one meaningful VEVENT, owned by the email domain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct CalendarInvitation {
    /// Content-derived component identity, stable across repeated extraction.
    pub id: String,
    /// Original provider MIME part identifier.
    pub source_part: String,
    /// Attachment to download when the original invitation is needed.
    pub attachment_id: Option<String>,
    /// SHA-256 of the decoded calendar part.
    pub content_hash: String,
    /// Version of the parser and policy producing this snapshot.
    pub parser_version: u16,
    /// iCalendar UID; never a Google provider event ID.
    pub uid: String,
    /// Original scheduling method.
    pub method: InvitationMethod,
    /// Scheduling revision, distinct from delivery order.
    pub sequence: u32,
    /// Scheduling timestamp in its original spelling.
    pub dtstamp: Option<String>,
    /// Last modification timestamp in its original spelling.
    pub last_modified: Option<String>,
    /// Original event status.
    pub status: Option<String>,
    /// Producer identifier; format recognition grants no permission.
    pub prodid: Option<String>,
    /// Original occurrence start, even when the instance moved.
    pub recurrence_id: Option<InvitationDateTime>,
    /// Original recurrence identifier spelling and parameters.
    pub recurrence_id_raw: Option<String>,
    /// Event summary.
    pub title: Option<String>,
    /// Organizer identity from the scheduling component.
    pub organizer: Option<InvitationParticipant>,
    /// Historical attendee identities and participation metadata.
    pub attendees: Vec<InvitationParticipant>,
    /// Reply or counter-proposal comment.
    pub comment: Option<String>,
    /// Plaintext event location.
    pub location: Option<String>,
    /// Plaintext description, retaining passwords and dial-in instructions.
    pub description: Option<String>,
    /// Original typed start, if supplied.
    pub start: Option<InvitationDateTime>,
    /// Exclusive typed end, if supplied.
    pub end: Option<InvitationDateTime>,
    /// Original DURATION when no explicit end was supplied.
    pub duration: Option<String>,
    /// Unexpanded RRULE/RDATE/EXDATE properties and parameters.
    pub recurrence: Vec<String>,
    /// Validated HTTP(S) conferencing URL; never fetched during rendering.
    pub conference_url: Option<String>,
    /// Validated HTTP(S) event URL.
    pub event_url: Option<String>,
    /// External file references; never fetched during rendering.
    pub files: Vec<String>,
    /// Preserved VTIMEZONE definitions for unresolved timezone interpretation.
    pub timezones: Vec<String>,
    /// Bounded, non-content reason codes describing incomplete interpretation.
    pub limitations: Vec<String>,
}
