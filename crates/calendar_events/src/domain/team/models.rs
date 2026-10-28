//! Team projections and the source facts used to authorize them.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::{
    AttendeeResponseStatus, CalendarAttendee, CalendarEvent, CalendarEventOverride,
    CalendarOccurrence, EventStatus, EventTime, EventTransparency, EventType, EventVisibility,
};

/// Maximum source occurrences loaded for an availability calculation.
pub const TEAM_AVAILABILITY_LIMIT: u32 = 20_000;

/// What a user exposes through their team membership.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum TeamCalendarSharing {
    /// Non-private event details from every synced calendar.
    All,
    /// Generic occupied intervals without event metadata.
    #[default]
    BusyOnly,
    /// No team-derived calendar access.
    None,
}

impl TeamCalendarSharing {
    /// Stored representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::BusyOnly => "busy_only",
            Self::None => "none",
        }
    }
}

/// Whether a member's calendar projection can establish availability.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum TeamCalendarCoverage {
    /// Every source has a recent, successful sync.
    Ready,
    /// No usable connected calendar or incomplete sync.
    Unavailable,
    /// The member does not share calendar data.
    Hidden,
}

/// A current member of the requester's team.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarMember {
    /// Macro user identifier.
    pub user_id: String,
    /// Current team-sharing policy.
    pub sharing: TeamCalendarSharing,
    /// Coverage available for a trustworthy calculation.
    pub coverage: TeamCalendarCoverage,
}

/// Content from exactly one authorized provider source; never a canonical merge.
#[derive(Clone, Debug)]
pub struct TeamSourceOccurrence {
    /// User whose current source access permits the team read.
    pub shared_by: String,
    /// Opaque provider-copy identifier internal to Macro.
    pub source_id: Uuid,
    /// Calendar containing this exact provider copy.
    pub calendar_id: Uuid,
    /// Name of this source calendar.
    pub calendar_name: String,
    /// Zone interpreting all-day dates on this source.
    pub calendar_time_zone: Option<String>,
    /// Whether this calendar was included in this user's personal availability.
    pub contributes_to_availability: bool,
    /// Addresses the sharing user owns, never delegated addresses.
    pub owner_emails: Vec<String>,
    /// Exact provider source's event snapshot.
    pub event: CalendarEvent,
    /// Exact provider source's occurrence snapshot.
    pub occurrence: CalendarOccurrence,
    /// Exact provider source's recurrence overrides.
    pub overrides: Vec<CalendarEventOverride>,
}

impl TeamSourceOccurrence {
    /// The effective interval from this source's exact occurrence or exception.
    pub fn time(&self) -> &EventTime {
        self.exception()
            .map(|exception| &exception.time)
            .unwrap_or(&self.occurrence.time)
    }

    /// Visibility used by a team view. An instance can restrict disclosure,
    /// but cannot unhide content from a private series snapshot.
    pub fn visibility(&self) -> EventVisibility {
        if matches!(
            self.event.visibility,
            EventVisibility::Private | EventVisibility::Confidential
        ) {
            return self.event.visibility;
        }
        self.exception()
            .and_then(|exception| exception.visibility)
            .unwrap_or(self.event.visibility)
    }

    /// The occurrence's availability, including a provider exception.
    pub fn transparency(&self) -> EventTransparency {
        self.exception()
            .and_then(|exception| exception.transparency)
            .unwrap_or(self.event.transparency)
    }

    /// Whether this source occurrence is eligible to contribute busy time.
    /// Keep points eligible here so conflicting positive copies are detected;
    /// projection and interval merging separately exclude their empty duration.
    pub fn is_busy(&self) -> bool {
        !self.occurrence.is_cancelled
            && self.event.status != EventStatus::Cancelled
            && self.exception().and_then(|item| item.status) != Some(EventStatus::Cancelled)
            && self.transparency() != EventTransparency::Transparent
            && !matches!(
                self.event.event_type,
                EventType::Birthday | EventType::WorkingLocation
            )
    }
    /// The source's exception for this occurrence.
    pub fn exception(&self) -> Option<&CalendarEventOverride> {
        let key = self.occurrence.recurrence_id.as_ref()?;
        self.overrides
            .iter()
            .find(|item| &item.recurrence_id == key)
    }

    /// Attendees with an occurrence-scoped response applied.
    pub fn attendees(&self) -> &[CalendarAttendee] {
        self.exception()
            .and_then(|item| item.attendees.as_deref())
            .unwrap_or(&self.event.attendees)
    }

    /// Whether this person's calendar/attendance makes the occurrence eligible
    /// for availability, before checking its duration or reconciling copies.
    pub fn is_personally_busy(&self) -> bool {
        if !self.is_busy() {
            return false;
        }
        let owned: Vec<_> = self
            .attendees()
            .iter()
            .filter(|attendee| {
                self.owner_emails
                    .iter()
                    .any(|email| email.eq_ignore_ascii_case(&attendee.email))
            })
            .collect();
        if !owned.is_empty()
            && owned
                .iter()
                .all(|attendee| attendee.response_status == AttendeeResponseStatus::Declined)
        {
            return false;
        }
        self.contributes_to_availability || !owned.is_empty()
    }
}

/// Authorized input for a domain availability calculation; never serialized.
#[derive(Clone, Debug)]
pub struct TeamAvailabilitySources {
    /// Selected known members, including the requester.
    pub members: Vec<TeamCalendarMember>,
    /// Same-source event snapshots authorized for the calculation.
    pub sources: Vec<TeamSourceOccurrence>,
    /// Whether every contributing row was loaded.
    pub complete: bool,
    /// Requested identifiers without a current team relationship.
    pub unknown_user_ids: Vec<String>,
}

/// Keyset position over authorized provider sources and their occurrences.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarCursor {
    /// Entitlement/source revision at the start of pagination.
    pub revision: String,
    /// Last sharing member.
    pub user_id: String,
    /// Last source snapshot.
    pub source_id: Uuid,
    /// Last occurrence within that source.
    pub occurrence_key: String,
}

/// Safe details from a single authorized source.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarDetails {
    /// Display title.
    pub title: String,
    /// Body, if supplied by this source.
    pub description: Option<String>,
    /// Location, if supplied by this source.
    pub location: Option<String>,
    /// Join URL, if supplied by this source.
    pub conference_url: Option<String>,
    /// Organizer address from this source.
    pub organizer_email: Option<String>,
    /// Organizer name from this source.
    pub organizer_name: Option<String>,
    /// Attendees; self flags are relative to the requesting viewer.
    pub attendees: Vec<CalendarAttendee>,
    /// Source calendar name, shown only with details.
    pub calendar_name: String,
}

/// Disjoint busy/detail shapes prevent new event fields leaking by default.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TeamCalendarContent {
    /// No provider or event metadata.
    Busy,
    /// Explicitly authorized source content.
    Details {
        /// Detail projection.
        details: TeamCalendarDetails,
    },
}

/// A read-only team calendar occurrence.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarItem {
    /// Stable opaque projection identity, never an event entity id.
    pub id: String,
    /// The person sharing access to the source.
    pub owner_id: String,
    /// Occurrence interval.
    pub time: EventTime,
    /// Whether this occurrence blocks the sharer's personal availability.
    /// A subscribed calendar's block can be shared without occupying the sharer.
    pub contributes_to_availability: bool,
    /// Authorized content variant.
    #[serde(flatten)]
    pub content: TeamCalendarContent,
}

/// A bounded page of team calendar projections.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarPage {
    /// Current membership and sharing policies.
    pub members: Vec<TeamCalendarMember>,
    /// Authorized read-only projections.
    pub items: Vec<TeamCalendarItem>,
    /// Opaque continuation token; null after the last source occurrence.
    pub next_cursor: Option<String>,
}

/// Per-user inclusion of a source calendar in personal availability.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityCalendar {
    /// Visible source calendar.
    pub calendar_id: Uuid,
    /// Source name.
    pub name: String,
    /// Whether its events normally block the user's time.
    pub contributes_to_availability: bool,
    /// Whether this is the connected account's primary calendar.
    pub is_primary: bool,
}
