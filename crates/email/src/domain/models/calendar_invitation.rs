//! Email-owned, immutable scheduling snapshots. These are never calendar sources.

use serde::{Deserialize, Serialize};

/// Version of the normalized snapshot format and extraction policy.
pub const INVITATION_PARSER_VERSION: u16 = 1;

/// Parser outcome for one message's calendar parts; internal to extraction.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum InvitationExtractionStatus {
    /// One or more scheduling components were found.
    Ready,
    /// There were no calendar parts to inspect.
    #[default]
    Absent,
    /// Calendar content could not be rendered safely.
    Unsupported,
}

/// Components parsed from one message's calendar parts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedInvitations {
    /// Whether any usable component was found.
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
}

/// Display snapshot of one meaningful VEVENT, owned by the email domain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
pub struct CalendarInvitation {
    /// Content-derived component identity, stable across repeated extraction.
    pub id: String,
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
    /// Exclusive typed end, derived from DURATION when DTEND is absent.
    pub end: Option<InvitationDateTime>,
    /// Validated HTTP(S) conferencing URL; never fetched during rendering.
    pub conference_url: Option<String>,
}
