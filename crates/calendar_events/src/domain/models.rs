//! Calendar domain models.

use std::collections::BTreeSet;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Top-level Google scope granting the complete calendar capability,
/// mirroring how email requests the single broad `gmail.modify` scope.
pub const GOOGLE_CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar";

/// The Google Calendar scopes Macro requests for the calendar capability.
pub const GOOGLE_CALENDAR_SCOPES: [&str; 1] = [GOOGLE_CALENDAR_SCOPE];
/// Build the space-delimited calendar scope fragment for an OAuth authorization URL.
pub fn google_calendar_scope_parameter() -> String {
    GOOGLE_CALENDAR_SCOPES.join(" ")
}

/// A normalized, deterministic set of OAuth scopes.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GoogleScopeSet(BTreeSet<String>);

impl GoogleScopeSet {
    /// Parse the space-delimited `scope` field returned by Google.
    pub fn parse(value: &str) -> Self {
        Self(
            value
                .split_ascii_whitespace()
                .map(ToOwned::to_owned)
                .collect(),
        )
    }

    /// Construct a scope set from stored values.
    pub fn from_scopes(scopes: impl IntoIterator<Item = String>) -> Self {
        Self(scopes.into_iter().collect())
    }

    /// Return the sorted scope values for durable storage.
    pub fn into_vec(self) -> Vec<String> {
        self.0.into_iter().collect()
    }

    /// Return whether a particular scope is present.
    pub fn contains(&self, scope: &str) -> bool {
        self.0.contains(scope)
    }

    /// Return whether the complete Macro calendar capability is present.
    pub fn has_calendar_capability(&self) -> bool {
        GOOGLE_CALENDAR_SCOPES
            .iter()
            .all(|scope| self.contains(scope))
    }
}

/// The mutually exclusive time shape of a calendar event.
///
/// Fields are renamed per variant rather than with `rename_all_fields`
/// because utoipa only honors variant-level serde renames when it
/// derives the OpenAPI schema.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EventTime {
    /// An event with absolute instants.
    #[serde(rename_all = "camelCase")]
    Timed {
        /// Inclusive start instant.
        starts_at: DateTime<Utc>,
        /// Exclusive end instant.
        ends_at: DateTime<Utc>,
        /// Original IANA time-zone identifier, when supplied.
        time_zone: Option<String>,
    },
    /// An all-day event using RFC 5545's exclusive end date.
    #[serde(rename_all = "camelCase")]
    AllDay {
        /// Inclusive local start date.
        start_date: NaiveDate,
        /// Exclusive local end date.
        end_date: NaiveDate,
    },
}

impl EventTime {
    /// Validate the exclusive end is later than the start.
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Timed {
                starts_at, ends_at, ..
            } => ends_at > starts_at,
            Self::AllDay {
                start_date,
                end_date,
            } => end_date > start_date,
        }
    }

    /// Return the stable occurrence key derived from this span's start.
    pub fn occurrence_key(&self) -> String {
        match self {
            Self::Timed { starts_at, .. } => starts_at.to_rfc3339(),
            Self::AllDay { start_date, .. } => start_date.to_string(),
        }
    }

    /// Return whether this span overlaps an occurrence query range.
    pub fn overlaps(&self, range: &OccurrenceRange) -> bool {
        match self {
            Self::Timed {
                starts_at, ends_at, ..
            } => starts_at < &range.ends_at && ends_at > &range.starts_at,
            Self::AllDay {
                start_date,
                end_date,
            } => start_date < &range.end_date && end_date > &range.start_date,
        }
    }
}

/// Canonical event status.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum EventStatus {
    /// Confirmed event.
    #[default]
    Confirmed,
    /// Tentatively accepted event.
    Tentative,
    /// Cancelled event retained for reconciliation.
    Cancelled,
}

impl EventStatus {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Tentative => "tentative",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Visibility of event details.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum EventVisibility {
    /// Provider or calendar default.
    #[default]
    Default,
    /// Public event.
    Public,
    /// Private event.
    Private,
    /// Confidential event.
    Confidential,
}

impl EventVisibility {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Public => "public",
            Self::Private => "private",
            Self::Confidential => "confidential",
        }
    }
}

/// Whether an event blocks availability.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum EventTransparency {
    /// Event blocks availability.
    #[default]
    Opaque,
    /// Event does not block availability.
    Transparent,
}

impl EventTransparency {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Opaque => "opaque",
            Self::Transparent => "transparent",
        }
    }
}

/// An attendee on a calendar event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CalendarAttendee {
    /// Normalized email address.
    pub email: String,
    /// Provider display name.
    pub display_name: Option<String>,
    /// RSVP state.
    pub response_status: AttendeeResponseStatus,
    /// Whether this attendee is the organizer.
    pub is_organizer: bool,
    /// Whether attendance is optional.
    pub is_optional: bool,
    /// Whether this attendee represents the connected account.
    pub is_self: bool,
    /// Optional attendee comment.
    pub comment: Option<String>,
}

/// RSVP state for an attendee.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum AttendeeResponseStatus {
    /// No response has been made.
    #[default]
    NeedsAction,
    /// Invitation accepted.
    Accepted,
    /// Invitation declined.
    Declined,
    /// Invitation tentatively accepted.
    Tentative,
}

impl AttendeeResponseStatus {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NeedsAction => "needs_action",
            Self::Accepted => "accepted",
            Self::Declined => "declined",
            Self::Tentative => "tentative",
        }
    }
}

/// A stable, first-class Macro calendar event entity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// Macro entity identifier.
    pub id: Uuid,
    /// Macro user who owns this event entity.
    pub owner_id: String,
    /// RFC 5545 UID used to reconcile provider and email sources.
    pub ical_uid: String,
    /// Display title.
    pub title: String,
    /// Optional event body.
    pub description: Option<String>,
    /// Optional physical or virtual location label.
    pub location: Option<String>,
    /// Event status.
    pub status: EventStatus,
    /// Event visibility.
    pub visibility: EventVisibility,
    /// Availability behavior.
    pub transparency: EventTransparency,
    /// Timed or all-day shape.
    pub time: EventTime,
    /// Raw RFC 5545 recurrence properties (`RRULE`, `RDATE`, `EXDATE`).
    pub recurrence_lines: Vec<String>,
    /// Organizer email.
    pub organizer_email: Option<String>,
    /// Organizer display name.
    pub organizer_name: Option<String>,
    /// Direct join URL when known.
    pub conference_url: Option<String>,
    /// Provider/iCalendar sequence number.
    pub sequence: u32,
    /// Whether the current user can edit the canonical source.
    pub is_read_only: bool,
    /// Attendees, keyed by email during persistence.
    pub attendees: Vec<CalendarAttendee>,
    /// Entity creation time.
    pub created_at: DateTime<Utc>,
    /// Entity update time.
    pub updated_at: DateTime<Utc>,
}

/// An exception to one instance of a recurring event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventOverride {
    /// Stable recurrence identifier from the source.
    pub recurrence_id: String,
    /// Original occurrence start.
    pub original_time: EventStart,
    /// Replacement time.
    pub time: EventTime,
    /// Optional replacement title.
    pub title: Option<String>,
    /// Optional replacement description.
    pub description: Option<String>,
    /// Optional replacement location.
    pub location: Option<String>,
    /// Optional replacement status.
    pub status: Option<EventStatus>,
}

/// A start-only value used to identify an overridden occurrence.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EventStart {
    /// Absolute start instant.
    Timed(DateTime<Utc>),
    /// Local all-day start.
    AllDay(NaiveDate),
}

impl EventStart {
    /// Return the stable recurrence key derived from this start.
    pub fn occurrence_key(&self) -> String {
        match self {
            Self::Timed(starts_at) => starts_at.to_rfc3339(),
            Self::AllDay(start_date) => start_date.to_string(),
        }
    }
}

/// A materialized recurrence instance optimized for range queries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrence {
    /// Owning event entity.
    pub event_id: Uuid,
    /// Stable key within the event.
    pub occurrence_key: String,
    /// Provider recurrence identifier, when applicable.
    pub recurrence_id: Option<String>,
    /// Instance time.
    pub time: EventTime,
    /// Whether the instance was cancelled.
    pub is_cancelled: bool,
}

/// Opaque keyset position for a deterministic occurrence page.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrenceCursor {
    /// Normalized UTC occurrence start used by the database ordering.
    pub starts_at: DateTime<Utc>,
    /// Event tie-breaker.
    pub event_id: Uuid,
    /// Stable occurrence tie-breaker within the event.
    pub occurrence_key: String,
}

impl CalendarOccurrenceCursor {
    /// Build the database ordering position for an occurrence.
    pub fn from_occurrence(occurrence: &CalendarOccurrence) -> Self {
        let starts_at = match occurrence.time {
            EventTime::Timed { starts_at, .. } => starts_at,
            EventTime::AllDay { start_date, .. } => start_date
                .and_hms_opt(0, 0, 0)
                .expect("midnight is a valid time")
                .and_utc(),
        };
        Self {
            starts_at,
            event_id: occurrence.event_id,
            occurrence_key: occurrence.occurrence_key.clone(),
        }
    }
}

/// Inclusive/exclusive viewport range for occurrence queries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OccurrenceRange {
    /// Inclusive UTC start.
    pub starts_at: DateTime<Utc>,
    /// Exclusive UTC end.
    pub ends_at: DateTime<Utc>,
    /// Inclusive local date start used for all-day overlap.
    pub start_date: NaiveDate,
    /// Exclusive local date end used for all-day overlap.
    pub end_date: NaiveDate,
}

/// Aggregate ingestion state across every calendar account visible to a
/// requester, letting clients render progressively while sources build.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum CalendarSyncStatus {
    /// At least one visible calendar account is still ingesting.
    Syncing,
    /// Every visible calendar account has finished its latest sync.
    Ready,
}

impl OccurrenceRange {
    /// Construct the bounded history/future window maintained by sync jobs.
    pub fn historical_sync(now: DateTime<Utc>) -> Self {
        let starts_at = now - chrono::Duration::days(365);
        let ends_at = now + chrono::Duration::days(730);
        Self {
            starts_at,
            ends_at,
            start_date: starts_at.date_naive(),
            end_date: ends_at.date_naive(),
        }
    }

    /// Construct the quantized window sync jobs maintain.
    ///
    /// The future edge rounds `now + 730d` up to the next month boundary, so
    /// the requested horizon only advances once a month instead of drifting
    /// with every poll and forcing needless coverage work. It always covers
    /// [`Self::historical_sync`], the window the read path accepts.
    pub fn maintenance_horizon(now: DateTime<Utc>) -> Self {
        let starts_at = now - chrono::Duration::days(365);
        let ends_at = month_ceil(now + chrono::Duration::days(730));
        Self {
            starts_at,
            ends_at,
            start_date: starts_at.date_naive(),
            end_date: ends_at.date_naive(),
        }
    }

    /// Return whether this viewport is covered by the occurrence window
    /// materialized by the ingestion pipelines.
    pub fn is_materialized_at(&self, now: DateTime<Utc>) -> bool {
        let materialized = Self::historical_sync(now);
        self.starts_at >= materialized.starts_at
            && self.ends_at <= materialized.ends_at
            && self.start_date >= materialized.start_date
            && self.end_date <= materialized.end_date
    }

    /// Validate the range and cap it to prevent accidental unbounded scans.
    pub fn is_valid(&self) -> bool {
        self.ends_at > self.starts_at
            && self.end_date > self.start_date
            && self.ends_at - self.starts_at <= chrono::Duration::days(370)
            && self.end_date - self.start_date <= chrono::Duration::days(370)
    }

    /// Validate the larger bounded window maintained by historical sync,
    /// including the month of quantization padding on the future edge.
    pub fn is_valid_for_backfill(&self) -> bool {
        self.ends_at > self.starts_at
            && self.end_date > self.start_date
            && self.ends_at - self.starts_at <= chrono::Duration::days(1130)
            && self.end_date - self.start_date <= chrono::Duration::days(1130)
    }
}

fn month_ceil(instant: DateTime<Utc>) -> DateTime<Utc> {
    use chrono::Datelike;

    let date = instant.date_naive();
    let (year, month) = if date.month() == 12 {
        (date.year() + 1, 1)
    } else {
        (date.year(), date.month() + 1)
    };
    NaiveDate::from_ymd_opt(year, month, 1)
        .expect("first day of a month is valid")
        .and_hms_opt(0, 0, 0)
        .expect("midnight is a valid time")
        .and_utc()
}

#[cfg(test)]
mod test;

/// Google provider identity for an event source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleEventSource {
    /// Connected inbox whose grant exposed this event.
    pub email_link_id: Uuid,
    /// Calendar account.
    pub account_id: Uuid,
    /// Calendar containing the source event.
    pub calendar_id: Uuid,
    /// Google event identifier.
    pub provider_event_id: String,
    /// Google recurring master identifier for an instance.
    pub provider_recurring_event_id: Option<String>,
    /// Google entity tag.
    pub provider_etag: Option<String>,
    /// Raw provider payload.
    pub raw_payload: serde_json::Value,
}

/// Source-specific metadata attached to a canonical event.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarEventSource {
    /// Event fetched from Google Calendar.
    Google(GoogleEventSource),
}

/// Event plus source and materialized projections to persist atomically.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventUpsert {
    /// Canonical event.
    pub event: CalendarEvent,
    /// Source that produced the update.
    pub source: CalendarEventSource,
    /// Recurrence overrides.
    pub overrides: Vec<CalendarEventOverride>,
    /// Materialized instances within the maintained horizon.
    pub occurrences: Vec<CalendarOccurrence>,
}

/// Persisted state needed to choose an incremental or full provider sync.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredGoogleCalendar {
    /// Persisted Macro calendar identifier.
    pub id: Uuid,
    /// Last provider continuation token successfully committed for this calendar.
    pub sync_token: Option<String>,
    /// Exact recurrence window materialized by the last full snapshot.
    pub materialized_range: Option<OccurrenceRange>,
    /// When this calendar's sync state last committed, if ever.
    pub synced_at: Option<DateTime<Utc>>,
    /// Expiry of the active push notification channel, when one exists.
    pub watch_expires_at: Option<DateTime<Utc>>,
}

/// How often Google's own read-only system calendars (holidays, birthdays)
/// are synced. Their content changes on the order of once a year, and Google
/// chronically resets their sync tokens, turning every poll into a full
/// snapshot; a daily cadence keeps them fresh without that churn.
pub const SYSTEM_CALENDAR_SYNC_INTERVAL: chrono::Duration = chrono::Duration::hours(24);

/// Whether a provider calendar is one of Google's shared system calendars
/// (`en.usa#holiday@group.v.calendar.google.com` and friends) rather than a
/// calendar a person maintains.
pub fn is_system_calendar(provider_calendar_id: &str) -> bool {
    provider_calendar_id.ends_with("@group.v.calendar.google.com")
}

/// Deployment configuration enabling Google push notification channels.
#[derive(Clone, PartialEq, Eq)]
pub struct GoogleWatchConfig {
    /// Public HTTPS address Google delivers notifications to.
    pub address: String,
    /// Shared verification token echoed back on every notification.
    pub token: String,
}

impl std::fmt::Debug for GoogleWatchConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GoogleWatchConfig")
            .field("address", &self.address)
            .field("token", &"<redacted>")
            .finish()
    }
}

/// An active Google push notification channel for one calendar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleWatchChannel {
    /// Client-minted channel identifier.
    pub channel_id: Uuid,
    /// Provider-assigned resource identifier required to stop the channel.
    pub resource_id: String,
    /// Provider-assigned channel expiry.
    pub expires_at: DateTime<Utc>,
}

/// How the provider adapter must reconcile one calendar this run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GoogleSyncPlan {
    /// Rebuild the complete bounded snapshot: no continuation token was
    /// committed or persisted coverage misses requested history.
    FullSnapshot,
    /// Apply the change feed, then materialize only the uncovered tail.
    ExtendTail {
        /// Exclusive instant where persisted coverage ends.
        from: DateTime<Utc>,
        /// Exclusive local date where persisted all-day coverage ends.
        from_date: NaiveDate,
    },
    /// Apply the change feed; persisted coverage already spans the request.
    Incremental,
}

impl StoredGoogleCalendar {
    /// Choose how the adapter must reconcile this calendar for a requested
    /// window, keeping full rebuilds for lost tokens or uncovered history
    /// and extending decayed future coverage incrementally.
    pub fn sync_plan(&self, requested: &OccurrenceRange) -> GoogleSyncPlan {
        let Some(materialized) = &self.materialized_range else {
            return GoogleSyncPlan::FullSnapshot;
        };
        if self.sync_token.is_none()
            || materialized.starts_at > requested.starts_at
            || materialized.start_date > requested.start_date
        {
            return GoogleSyncPlan::FullSnapshot;
        }
        if materialized.ends_at < requested.ends_at || materialized.end_date < requested.end_date {
            return GoogleSyncPlan::ExtendTail {
                from: materialized.ends_at,
                from_date: materialized.end_date,
            };
        }
        GoogleSyncPlan::Incremental
    }
}

/// Normalized result of one provider calendar's incremental poll.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleEventSyncBatch {
    /// Valid events normalized from the current bounded snapshot.
    pub upserts: Vec<CalendarEventUpsert>,
    /// Provider master identifiers observed in a complete bounded snapshot.
    ///
    /// `None` means the continuation token reported no relevant change and no
    /// destructive snapshot reconciliation may run.
    pub observed_provider_event_ids: Option<Vec<String>>,
    /// Provider continuation token to persist only with the fenced sync.
    pub next_sync_token: String,
    /// Range rebuilt by this batch, or `None` for a token-only no-op poll.
    pub materialized_range: Option<OccurrenceRange>,
    /// Provider event identifiers the change feed reported cancelled.
    ///
    /// Applied even when no full snapshot ran, so incremental polls can
    /// retire sources without a destructive account sweep. A recurring
    /// master's identifier also retires its expanded instances.
    pub cancelled_provider_event_ids: Vec<String>,
}

/// Durable state committed for one calendar as soon as its poll completes,
/// so a later calendar's failure cannot discard this calendar's progress.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleCalendarSyncSnapshot {
    /// Persisted Macro calendar identifier.
    pub calendar_id: Uuid,
    /// Provider continuation token returned by the successful poll.
    pub next_sync_token: String,
    /// Provider event identifiers observed when a full snapshot ran.
    pub observed_provider_event_ids: Option<Vec<String>>,
    /// Exact occurrence range rebuilt by a full snapshot.
    pub materialized_range: Option<OccurrenceRange>,
    /// Provider event identifiers the change feed reported cancelled.
    pub cancelled_provider_event_ids: Vec<String>,
}

/// Kind of idempotent historical work triggered by a Google grant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarBackfillKind {
    /// Fetch calendars and canonical provider events.
    GoogleCalendar,
}

impl CalendarBackfillKind {
    /// Database representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GoogleCalendar => "google_calendar",
        }
    }
}

/// Backfill work created by a grant update.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarBackfillJob {
    /// Job identifier.
    pub id: Uuid,
    /// Connected email link.
    pub email_link_id: Uuid,
    /// Calendar account, when already provisioned.
    pub account_id: Option<Uuid>,
    /// Work type.
    pub kind: CalendarBackfillKind,
    /// Grant version this work covers.
    pub grant_version: i64,
}

/// Stable identity of one calendar backfill queue job.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CalendarBackfillJobKey {
    /// Durable calendar job identifier.
    pub job_id: Uuid,
    /// Connected inbox the job belongs to.
    pub email_link_id: Uuid,
}

/// Result of trying to fence a Google Calendar backfill delivery.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarBackfillClaim {
    /// This delivery owns the returned fencing token.
    Claimed {
        /// Token required by every subsequent lifecycle transition.
        lease_token: Uuid,
        /// Calendar account provisioned by the grant transaction.
        account_id: Uuid,
    },
    /// The durable job already completed.
    Complete,
    /// Another delivery currently owns the lease.
    Busy,
    /// The durable job already failed permanently.
    Failed,
    /// No matching Google Calendar job exists.
    NotFound,
}

/// Durable action to take after Google provider or persistence failure.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarBackfillFailureDisposition {
    /// Release the lease and allow queue retry.
    Retry,
    /// Finish the job as a permanent provider failure.
    Permanent,
    /// Finish the job and mark the entire connected inbox for reauthorization.
    ReauthRequired,
    /// Finish the job because the calendar capability, but not necessarily the
    /// Gmail grant, needs incremental consent.
    CalendarPermissionRequired,
}

/// Durable effects applied while failing a Google Calendar backfill.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CalendarBackfillFailureOutcome {
    /// Whether an active calendar job transitioned to its requested failure state.
    pub job_transitioned: bool,
    /// Whether the associated inbox newly transitioned to require reauthorization.
    pub link_reauth_transitioned: bool,
}

/// Result of applying an OAuth grant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedGoogleGrant {
    /// Monotonic version of the stored grant.
    pub grant_version: i64,
    /// Whether the durable set of scopes changed.
    pub changed: bool,
    /// Newly scheduled idempotent work.
    pub jobs: Vec<CalendarBackfillJob>,
}

/// A calendar in a provider account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderCalendar {
    /// Provider calendar identifier.
    pub provider_calendar_id: String,
    /// Display name.
    pub name: String,
    /// Description.
    pub description: Option<String>,
    /// IANA timezone.
    pub time_zone: Option<String>,
    /// Provider color.
    pub color: Option<String>,
    /// Provider access role.
    pub access_role: Option<String>,
    /// Whether this is the account's primary calendar.
    pub is_primary: bool,
    /// Whether Macro should display/sync it by default.
    pub is_selected: bool,
}
