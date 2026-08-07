//! Ports implemented by calendar adapters.

use std::future::Future;

use chrono::{DateTime, Utc};
use rootcause::Report;
use uuid::Uuid;

use super::models::{
    AppliedGoogleGrant, CalendarBackfillClaim, CalendarBackfillFailureDisposition,
    CalendarBackfillFailureOutcome, CalendarBackfillJobKey, CalendarEvent, CalendarEventUpsert,
    CalendarOccurrence, CalendarOccurrenceCursor, CalendarSyncStatus, GoogleCalendarSyncSnapshot,
    GoogleEventSyncBatch, GoogleScopeSet, GoogleSyncPlan, GoogleWatchChannel, GoogleWatchConfig,
    OccurrenceRange, ProviderCalendar, StoredGoogleCalendar,
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
    /// Macro user who owns the resulting entities.
    pub owner_id: String,
    /// Connected inbox whose grant authorizes the request.
    pub email_link_id: Uuid,
    /// Calendar account persisted for the connected inbox.
    pub account_id: Uuid,
    /// Persisted Macro calendar identifier.
    pub calendar_id: Uuid,
    /// Provider calendar identifier used in Google API paths.
    pub provider_calendar_id: String,
    /// Whether the provider role prohibits event mutation.
    pub is_read_only: bool,
    /// Occurrence window to materialize.
    pub range: OccurrenceRange,
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
    /// Unfenced persistence used only by PostgreSQL adapter fixtures.
    #[cfg(test)]
    Fixture(CalendarEventUpsert),
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
