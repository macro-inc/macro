//! Ports implemented by calendar adapters.

use std::future::Future;

use chrono::{DateTime, Utc};
use rootcause::Report;
use uuid::Uuid;

use super::models::{
    AppliedGoogleGrant, AttendeeResponseStatus, CalendarBackfillClaim,
    CalendarBackfillFailureDisposition, CalendarBackfillFailureOutcome, CalendarBackfillJobKey,
    CalendarCreationTarget, CalendarEvent, CalendarEventDraft, CalendarEventMutationTarget,
    CalendarEventPatch, CalendarEventUpsert, CalendarLinkTokenIdentity, CalendarOccurrence,
    CalendarOccurrenceCursor, CalendarSyncStatus, GoogleCalendarSyncSnapshot, GoogleCalendarTarget,
    GoogleEventSyncBatch, GoogleScopeSet, GoogleSyncPlan, GoogleWatchChannel, GoogleWatchConfig,
    OccurrenceRange, ProviderCalendar, StoredGoogleCalendar, VisibleCalendar,
};

/// Classification supplied by provider adapters to backfill policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GoogleProviderErrorKind {
    /// Transport, throttling, timeout, or server failure that may recover.
    Transient,
    /// A permanent request failure unrelated to grant health.
    Permanent,
    /// The connected grant is invalid, revoked, or insufficient.
    ReauthRequired,
    /// The provider continuation token expired and requires a full resync.
    SyncTokenExpired,
}

/// Typed Google Calendar failure returned across the provider port.
#[derive(Debug, thiserror::Error)]
#[error("Google Calendar provider request failed: {message}")]
pub struct GoogleProviderError {
    kind: GoogleProviderErrorKind,
    message: String,
}

impl GoogleProviderError {
    /// Construct a classified provider failure.
    pub fn new(kind: GoogleProviderErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Return the retry/reauthorization classification.
    pub fn kind(&self) -> GoogleProviderErrorKind {
        self.kind
    }
}

/// Stable identifiers and sync policy for one provider calendar fetch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleEventSyncContext {
    /// Calendar identity and materialization window.
    pub target: GoogleCalendarTarget,
    /// Last continuation token committed for this provider calendar.
    pub sync_token: Option<String>,
    /// Domain-chosen reconciliation mode for this run.
    pub plan: GoogleSyncPlan,
}

/// Authorized ingestion command for one normalized calendar event.
pub enum CalendarEventWrite {
    /// Google event written while holding a durable backfill lease.
    GoogleBackfill {
        /// Durable job and connected-inbox identity.
        key: CalendarBackfillJobKey,
        /// Current lease token held by the worker.
        lease_token: Uuid,
        /// Normalized provider event.
        upsert: CalendarEventUpsert,
    },
    /// Provider echo of a user-initiated mutation the caller already
    /// authorized. Unfenced: Google acknowledged the write, so persisting
    /// its response races sync only through the per-event advisory lock.
    UserMutation(CalendarEventUpsert),
    /// Unfenced persistence used only by PostgreSQL adapter fixtures.
    #[cfg(test)]
    Fixture(CalendarEventUpsert),
}

/// Classified failure minting an access token for a connected inbox.
#[derive(Debug, thiserror::Error)]
pub enum CalendarTokenError {
    /// The grant is invalid, revoked, or missing the calendar capability.
    #[error("calendar access token requires reauthorization: {0}")]
    ReauthRequired(String),
    /// Transport or infrastructure failure that may recover.
    #[error("calendar access token fetch failed transiently: {0}")]
    Transient(String),
}

/// Access-token acquisition for provider calls made outside backfill workers.
pub trait CalendarAccessTokenProvider: Send + Sync + 'static {
    /// Mint or reuse an access token for the connected inbox.
    fn fetch_access_token(
        &self,
        identity: &CalendarLinkTokenIdentity,
    ) -> impl Future<Output = Result<String, CalendarTokenError>> + Send;
}

/// Provider write operations used by user-initiated calendar mutations.
///
/// Every method that changes provider state returns the normalized echo of
/// the affected event so the caller can persist read-your-writes state; the
/// adapter owns recurrence expansion by refreshing changed series bounded to
/// the target's window, exactly like ingestion.
pub trait GoogleCalendarMutationProvider: Send + Sync + 'static {
    /// Insert a new event into the target calendar.
    fn create_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        draft: &CalendarEventDraft,
    ) -> impl Future<Output = Result<CalendarEventUpsert, GoogleProviderError>> + Send;

    /// Patch the supplied fields of an existing event. Returns `None` when
    /// the event no longer exists at the provider.
    fn update_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
        patch: &CalendarEventPatch,
    ) -> impl Future<Output = Result<Option<CalendarEventUpsert>, GoogleProviderError>> + Send;

    /// Delete an event. An event already gone at the provider is success.
    fn delete_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
    ) -> impl Future<Output = Result<(), GoogleProviderError>> + Send;

    /// Delete one occurrence of a recurring series, identified by its
    /// original start key, then refresh the series. An occurrence already
    /// gone at the provider refreshes without deleting.
    fn delete_event_instance(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> impl Future<Output = Result<GoogleSeriesMutationOutcome, GoogleProviderError>> + Send;

    /// End a recurring series just before the identified occurrence,
    /// deleting the series outright when nothing would remain.
    fn truncate_recurring_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> impl Future<Output = Result<GoogleSeriesMutationOutcome, GoogleProviderError>> + Send;

    /// Set the connected account's own RSVP on an event. An event that no
    /// longer exists at the provider surfaces as [`GoogleRsvpOutcome::Gone`];
    /// absence of a self attendee surfaces as
    /// [`GoogleRsvpOutcome::NotAttendee`].
    fn rsvp_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        provider_event_id: &str,
        self_email: &str,
        response: AttendeeResponseStatus,
    ) -> impl Future<Output = Result<GoogleRsvpOutcome, GoogleProviderError>> + Send;
}

/// How much of a recurring series a deletion removes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarDeletionScope {
    /// The entire event or series.
    All,
    /// One occurrence, identified by its original start key.
    ThisEvent {
        /// Stable original-start key of the occurrence.
        recurrence_id: String,
    },
    /// The identified occurrence and everything after it.
    ThisAndFollowing {
        /// Stable original-start key of the first removed occurrence.
        recurrence_id: String,
    },
}

/// Result of a provider mutation that reshapes a recurring series.
pub enum GoogleSeriesMutationOutcome {
    /// The series survives; the echo carries its refreshed state.
    Applied(Box<CalendarEventUpsert>),
    /// The provider no longer has any of the series.
    SeriesDeleted,
    /// The series master vanished before the mutation could apply.
    Gone,
}

/// Result of attempting to set the connected account's RSVP.
pub enum GoogleRsvpOutcome {
    /// The RSVP was applied; the echo carries the refreshed event.
    Applied(Box<CalendarEventUpsert>),
    /// The connected account is not an attendee of the event.
    NotAttendee,
    /// The event no longer exists at the provider.
    Gone,
}

/// Inbound service port for querying calendar occurrence projections.
pub trait CalendarOccurrenceService: Send + Sync + 'static {
    /// Return occurrences visible to a requester in a bounded viewport.
    fn list_occurrences(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<(CalendarEvent, CalendarOccurrence)>, Report>> + Send;

    /// Return the aggregate ingestion state of the requester's visible accounts.
    fn sync_status(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<CalendarSyncStatus, Report>> + Send;
}

/// Persistence operations used by calendar business logic.
pub trait CalendarRepository: Send + Sync + 'static {
    /// Apply the actual scopes returned by Google and atomically schedule any
    /// newly unlocked historical work.
    fn apply_google_grant(
        &self,
        email_link_id: Uuid,
        scopes: GoogleScopeSet,
    ) -> impl Future<Output = Result<AppliedGoogleGrant, Report>> + Send;

    /// Upsert an event through an explicit, source-matched ingestion authority.
    fn upsert_event(
        &self,
        write: CalendarEventWrite,
    ) -> impl Future<Output = Result<Uuid, Report>> + Send;

    /// Return occurrences visible to a requester across owned and delegated inboxes.
    fn list_occurrences(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<(CalendarEvent, CalendarOccurrence)>, Report>> + Send;

    /// Return the aggregate ingestion state across the requester's visible accounts.
    fn sync_status(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<CalendarSyncStatus, Report>> + Send;

    /// Upsert one provider calendar while holding the current backfill fence.
    fn upsert_google_calendar(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar: ProviderCalendar,
    ) -> impl Future<Output = Result<StoredGoogleCalendar, Report>> + Send;

    /// Durably commit one calendar's poll under the backfill's fencing token:
    /// prune sources a full snapshot no longer observed, advance the
    /// calendar's continuation token and materialized range, and add this
    /// calendar's upserts to the job's running progress counters.
    fn commit_google_calendar_sync(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        sync: GoogleCalendarSyncSnapshot,
        events_upserted: usize,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Record a freshly opened push channel for one calendar under the
    /// backfill's fencing token.
    fn record_watch_channel(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar_id: Uuid,
        channel: GoogleWatchChannel,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Resolve a push notification to the inbox whose calendar it watches.
    fn find_watch_target(
        &self,
        channel_id: &str,
        resource_id: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Report>> + Send;

    /// Re-arm a completed sync job for one inbox, returning whether a run
    /// was scheduled. Pending or running jobs absorb the notification.
    fn schedule_google_sync_for_link(
        &self,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<bool, Report>> + Send;

    /// Reconcile the provider's calendar list under the backfill's fencing
    /// token, removing calendars and sources no longer returned by Google.
    fn reconcile_google_calendar_list(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar_ids: Vec<Uuid>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Resolve an event visible to the requester to its best Google source
    /// and the connected inbox that can mutate it. `None` covers both an
    /// unknown event and one the requester cannot see.
    fn get_event_mutation_target(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarEventMutationTarget>, Report>> + Send;

    /// Resolve the calendar a requester-created event lands in: the exact
    /// calendar when one is supplied, otherwise the supplied inbox's primary
    /// calendar, otherwise the requester's primary inbox's primary calendar.
    fn get_creation_target(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Option<CalendarCreationTarget>, Report>> + Send;

    /// List every calendar visible to the requester across owned and
    /// delegated inboxes, primaries and writables first.
    fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Vec<VisibleCalendar>, Report>> + Send;

    /// Retire a Google source the provider confirmed deleted (a recurring
    /// master also retires its expanded instances), restoring the best
    /// surviving source or removing the entity, mirroring feed tombstones.
    fn remove_google_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Inbound service port for user-initiated calendar event mutations.
pub trait CalendarMutationService: Send + Sync + 'static {
    /// Create an event on the selected calendar — or the requester's (or
    /// the supplied inbox's) primary calendar — and persist the provider echo.
    fn create_event(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// List the calendars the requester can see, flagged for writability.
    fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Vec<VisibleCalendar>, CalendarMutationError>> + Send;

    /// Patch an event at its provider and persist the echo.
    fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        patch: CalendarEventPatch,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Delete an event at its provider — entirely, one occurrence, or from
    /// an occurrence onward — and reconcile the local projection.
    fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        scope: CalendarDeletionScope,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;

    /// Set the requester's inbox RSVP on an event and persist the echo.
    fn respond_to_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        response: AttendeeResponseStatus,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;
}

/// Use-case failures surfaced by calendar mutations.
#[derive(Debug, thiserror::Error)]
pub enum CalendarMutationError {
    /// The event does not exist or is not visible to the requester.
    #[error("calendar event was not found")]
    NotFound,
    /// The containing calendar prohibits mutation.
    #[error("calendar event is read-only")]
    ReadOnly,
    /// No writable calendar exists for the requester to create events in.
    #[error("no connected calendar can accept new events")]
    NoWritableCalendar,
    /// The connected account is not an attendee of the event.
    #[error("the connected account is not an attendee of this event")]
    NotAttendee,
    /// The supplied fields were invalid.
    #[error("invalid calendar mutation: {0}")]
    InvalidInput(String),
    /// The provider grant must be refreshed by the user.
    #[error("calendar mutation requires reauthorization: {0}")]
    ReauthRequired(String),
    /// The provider rejected the mutation permanently.
    #[error("calendar provider rejected the mutation: {0}")]
    ProviderRejected(String),
    /// Provider or infrastructure failure that may recover on retry.
    #[error("calendar mutation failed transiently: {0}")]
    Retryable(String),
    /// Persistence failed after the provider accepted the mutation; sync
    /// will converge the local projection.
    #[error("calendar mutation was applied but local persistence failed: {0}")]
    PersistFailed(String),
}

/// Provider API operations used by the Google backfill adapter.
pub trait GoogleCalendarProvider: Send + Sync + 'static {
    /// List every calendar visible to the grant.
    fn list_calendars(
        &self,
        access_token: &str,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ProviderCalendar>, GoogleProviderError>> + Send;

    /// Poll provider changes and, when needed, rebuild the bounded event snapshot.
    fn sync_events(
        &self,
        access_token: &str,
        context: GoogleEventSyncContext,
    ) -> impl Future<Output = Result<GoogleEventSyncBatch, GoogleProviderError>> + Send;

    /// Open a push notification channel for one provider calendar.
    fn watch_calendar(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        channel_id: Uuid,
        config: &GoogleWatchConfig,
    ) -> impl Future<Output = Result<GoogleWatchChannel, GoogleProviderError>> + Send;
}

/// Durable scheduling operations for periodic provider maintenance.
pub trait GoogleCalendarSyncRepository: Send + Sync + 'static {
    /// Reset completed current-grant jobs that are due for another incremental poll.
    fn schedule_due_google_syncs(
        &self,
        due_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<usize, Report>> + Send;
}

/// Durable lifecycle and lease operations for calendar backfill jobs.
pub trait CalendarBackfillRepository: Send + Sync + 'static {
    /// Persist a terminal failure that happened before a lease was acquired.
    fn fail_unclaimed_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> impl Future<Output = Result<CalendarBackfillFailureOutcome, Report>> + Send;

    /// Claim a Google Calendar job, fencing all later writes with a new token.
    fn claim_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
    ) -> impl Future<Output = Result<CalendarBackfillClaim, Report>> + Send;

    /// Mark the account as actively syncing after a successful claim.
    fn mark_google_account_syncing(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Maintain the fenced lease until cancelled or ownership is lost.
    fn maintain_google_backfill_lease(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Atomically complete the job and mark its account ready; progress
    /// counters were already accumulated by the per-calendar commits.
    fn complete_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Persist a classified failure, releasing or terminating the job.
    fn fail_google_backfill(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> impl Future<Output = Result<CalendarBackfillFailureOutcome, Report>> + Send;
}
