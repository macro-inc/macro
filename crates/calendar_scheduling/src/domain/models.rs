//! Scheduling value objects and persisted booking records.
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

/// A wall-clock window in an availability schedule.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    /// Inclusive HH:MM start.
    pub start: String,
    /// Exclusive HH:MM end.
    pub end: String,
}
/// Availability for one weekday.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WeeklyDay {
    /// Sunday is zero.
    pub day: u8,
    /// Non-overlapping local windows.
    pub windows: Vec<TimeWindow>,
}
/// Replacement availability for one date.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DateOverride {
    /// Local date in the schedule zone.
    pub date: NaiveDate,
    /// Empty means unavailable all day.
    pub windows: Vec<TimeWindow>,
}
/// Reusable hours, with DST interpreted in an IANA zone.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    /// Stable schedule identity.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// IANA time zone.
    pub time_zone: chrono_tz::Tz,
    /// Weekly windows.
    pub weekly: Vec<WeeklyDay>,
    /// Date-specific replacements.
    pub overrides: Vec<DateOverride>,
}
/// Team host assignment policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SchedulingMode {
    /// One personal host.
    Individual,
    /// Every selected host must be available.
    Collective,
    /// Assign one available host, balancing booking counts.
    RoundRobin,
}
/// A question on the booking form.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Question {
    /// Stable identity.
    pub id: Uuid,
    /// Public question label.
    pub label: String,
    /// Whether an answer is mandatory.
    pub required: bool,
}
/// A reusable booking link.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventType {
    /// Stable identity.
    pub id: Uuid,
    /// Public title.
    pub title: String,
    /// Unique link segment within a profile.
    pub slug: String,
    /// Public description.
    pub description: String,
    /// Meeting duration.
    pub duration_minutes: u16,
    /// Meeting location.
    pub location: String,
    /// Generate a Google Meet conference.
    pub google_meet: bool,
    /// Whether new bookings are accepted.
    pub enabled: bool,
    /// Referenced availability schedule.
    pub schedule_id: Uuid,
    /// Host assignment policy.
    pub mode: SchedulingMode,
    /// Current Macro user identities selected as hosts.
    pub hosts: Vec<String>,
    /// Protected time before a meeting.
    pub before_minutes: u16,
    /// Protected time after a meeting.
    pub after_minutes: u16,
    /// Minimum notice in minutes.
    pub notice_minutes: u16,
    /// Maximum days ahead.
    pub horizon_days: u16,
    /// Spacing of offered start times.
    pub interval_minutes: u16,
    /// Maximum bookings for this event on one schedule-local day.
    pub daily_limit: Option<u16>,
    /// Hold bookings for host approval.
    pub requires_confirmation: bool,
    /// Additional form fields.
    pub questions: Vec<Question>,
}
/// Editable configuration for a person or team.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Public, opaque profile identity.
    pub id: Uuid,
    /// Display name on the public page.
    pub name: String,
    /// Public introduction.
    pub description: String,
    /// Reusable schedules.
    pub schedules: Vec<Schedule>,
    /// Personal hours used by team events; absent legacy profiles use their first schedule.
    #[serde(default)]
    pub default_schedule_id: Option<Uuid>,
    /// Booking links.
    pub event_types: Vec<EventType>,
    /// Optimistic concurrency version.
    pub revision: i64,
}
/// A profile's private ownership boundary.
#[derive(Clone, Debug)]
pub struct OwnedProfile {
    /// Owning Macro user, absent for team profiles.
    pub user_id: Option<String>,
    /// Owning Macro team, absent for personal profiles.
    pub team_id: Option<Uuid>,
    /// Editable/public configuration.
    pub profile: Profile,
}
/// Booking lifecycle state.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookingStatus {
    /// Reserved, awaiting host confirmation.
    Pending,
    /// Provider calendar has accepted the event.
    Confirmed,
    /// Cancellation completed.
    Cancelled,
    /// Reserved while a calendar operation is in flight.
    Processing,
    /// Calendar write failed; reservation retained for safe reconciliation.
    Failed,
}
/// Attendance recorded by an assigned host or profile administrator after a meeting.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookingAttendance {
    /// Attendance has not been recorded; elapsed time does not imply attendance.
    #[default]
    Unknown,
    /// The meeting took place with the expected participants.
    Attended,
    /// The guest did not attend.
    GuestNoShow,
    /// A required host did not attend.
    HostNoShow,
}
/// Public booking details, also visible to authorized profile members.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Booking {
    /// Booking identity.
    pub id: Uuid,
    /// Booking link identity.
    pub event_type_id: Uuid,
    /// Snapshot of the meeting title.
    pub title: String,
    /// Booker's name.
    pub name: String,
    /// Booker's email.
    pub email: String,
    /// Absolute meeting start.
    pub starts_at: DateTime<Utc>,
    /// Absolute meeting end.
    pub ends_at: DateTime<Utc>,
    /// Booker's display time zone.
    pub time_zone: chrono_tz::Tz,
    /// Assigned hosts.
    pub hosts: Vec<String>,
    /// Current lifecycle state.
    pub status: BookingStatus,
    /// Explicit attendance outcome; existing booking records default to unknown.
    #[serde(default)]
    pub attendance: BookingAttendance,
    /// Number of successfully completed moves to a different start time.
    #[serde(default)]
    pub reschedule_count: u16,
    /// When the most recent successful reschedule completed.
    #[serde(default)]
    pub rescheduled_at: Option<DateTime<Utc>>,
    /// Final location or conference URL.
    pub location: String,
    /// Answers keyed by question identity.
    pub answers: BTreeMap<Uuid, String>,
}
/// Private persisted state, never returned from a public profile endpoint.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingRecord {
    /// Monotonic version fencing every mutation, including same-status edits.
    #[serde(default)]
    pub revision: u32,
    /// Event rules captured at booking time, so deleting a link cannot orphan bookings.
    pub event: EventType,
    /// Availability schedule captured when the booking was made.
    pub schedule: Schedule,
    /// Booking details.
    pub booking: Booking,
    /// Owning profile.
    pub profile_id: Uuid,
    /// Unguessable booker management capability.
    pub token: Uuid,
    /// Client-generated idempotency identity.
    pub request_id: Uuid,
    /// Creation calendar pinned before the first provider attempt.
    #[serde(default)]
    pub calendar_id: Option<Uuid>,
    /// Durable intent and retry fence for an in-flight provider operation.
    #[serde(default)]
    pub operation: Option<CalendarOperation>,
    /// Calendar event produced by the provider.
    pub calendar_event_id: Option<Uuid>,
    /// Earliest occupied instant including buffer.
    pub busy_start: DateTime<Utc>,
    /// Latest occupied instant including buffer.
    pub busy_end: DateTime<Utc>,
}
/// A request to reserve an offered slot.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookingRequest {
    /// Selected absolute start.
    pub starts_at: DateTime<Utc>,
    /// Booker name.
    pub name: String,
    /// Booker email.
    pub email: String,
    /// Booker display zone.
    pub time_zone: chrono_tz::Tz,
    /// Question answers.
    pub answers: BTreeMap<Uuid, String>,
    /// Unique retry-safe operation identity.
    pub request_id: Uuid,
}
/// A host's occupied range.
#[derive(Clone, Debug)]
pub struct BusyRange {
    /// Host identity.
    pub host: String,
    /// Inclusive instant.
    pub start: DateTime<Utc>,
    /// Exclusive instant.
    pub end: DateTime<Utc>,
}
/// Available slot and the hosts who can satisfy it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    /// Absolute start.
    pub starts_at: DateTime<Utc>,
    /// Absolute end.
    pub ends_at: DateTime<Utc>,
    /// Host candidates, retained only on the server.
    #[serde(skip)]
    pub hosts: Vec<String>,
}
/// Membership facts from the owning teams domain.
#[derive(Clone, Debug)]
pub struct TeamMember {
    /// Macro user identity.
    pub user_id: String,
    /// Whether this member administers scheduling.
    pub admin: bool,
}
/// Use-case failures mapped by transport adapters.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Invalid configuration or request.
    #[error("{0}")]
    Invalid(String),
    /// Missing profile, link, or booking.
    #[error("Scheduling resource not found")]
    NotFound,
    /// Caller lacks membership or editing rights.
    #[error("You do not have permission to manage this calendar")]
    Forbidden,
    /// Stale revision or slot no longer available.
    #[error("This time or configuration has changed. Refresh and try again.")]
    Conflict,
    /// A host's calendar is not available for reliable conflict checking.
    #[error("A host's calendar is unavailable or still syncing. Please try again later.")]
    CalendarUnavailable,
    /// Public scheduling budget is exhausted for this profile.
    #[error("Too many scheduling requests. Please try again later.")]
    RateLimited,
    /// Persistence or provider operation failed.
    #[error("Scheduling is temporarily unavailable")]
    Unavailable,
}

/// Published booking-page fields, excluding internal hosts and scheduling configuration.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicProfile {
    /// Opaque page identity.
    pub id: Uuid,
    /// Public owner name.
    pub name: String,
    /// Public introduction.
    pub description: String,
    /// Only currently enabled booking links.
    pub event_types: Vec<PublicEvent>,
}
/// Public presentation of a bookable event.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicEvent {
    /// Event identity.
    pub id: Uuid,
    /// Public title.
    pub title: String,
    /// Link path segment.
    pub slug: String,
    /// Public description.
    pub description: String,
    /// Meeting length.
    pub duration_minutes: u16,
    /// Location shared by the host.
    pub location: String,
    /// Whether a Google Meet will be created.
    pub google_meet: bool,
    /// Information requested from the booker.
    pub questions: Vec<Question>,
    /// Whether the host must approve.
    pub requires_confirmation: bool,
    /// Individual or team scheduling behavior.
    pub mode: SchedulingMode,
}

/// Durable provider intent. A recovery worker resumes the same operation after a crash.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOperation {
    /// Stable identity fencing completion against newer operations.
    pub id: Uuid,
    /// Number of recovery claims; also fences an expired worker.
    pub attempt: u32,
    /// Earliest time another worker may claim this operation.
    pub retry_at: DateTime<Utc>,
    /// Intended provider change, retained through failures.
    pub kind: CalendarOperationKind,
}
/// Provider changes that can be retried without creating a second event.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CalendarOperationKind {
    /// Create one event using the booking identity as the idempotency key.
    Create,
    /// Move the existing event and restore this terminal booking status.
    Move {
        /// Status before the move.
        status: BookingStatus,
        /// Original start, used to count successful changes exactly once.
        original_start: DateTime<Utc>,
    },
    /// Cancel the provider event before releasing its host reservations.
    Cancel,
}

/// Shared public API budgets, independent of application replica count.
#[derive(Clone, Copy)]
pub enum PublicBudget {
    /// Availability calculations: 120 per minute per profile.
    Availability,
    /// New reservations: 30 per hour per profile.
    Booking,
}
