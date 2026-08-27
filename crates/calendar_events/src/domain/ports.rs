//! Ports implemented by calendar adapters.

use std::future::Future;

use chrono::{DateTime, Utc};
use rootcause::Report;
use uuid::Uuid;

use super::models::{
    ActorInboxes, AppliedGoogleGrant, AttendeeResponseStatus, CalendarBackfillClaim,
    CalendarBackfillFailureDisposition, CalendarBackfillFailureOutcome, CalendarBackfillJobKey,
    CalendarCreationTarget, CalendarEvent, CalendarEventDraft, CalendarEventMutationTarget,
    CalendarEventPatch, CalendarEventUpsert, CalendarGrantIntent, CalendarLinkTokenIdentity,
    CalendarMentionPreview, CalendarMentionRequestItem, CalendarOccurrence,
    CalendarOccurrenceCursor, CalendarReminderDeliveryOutcome, CalendarReminderDispatchMessage,
    CalendarReminderFiring, CalendarReminderSweepSummary, CalendarSyncStatus,
    DisconnectedGoogleCalendar, DueCalendarReminder, GoogleCalendarSyncSnapshot,
    GoogleCalendarTarget, GoogleEventSyncBatch, GoogleScopeSet, GoogleSyncPlan, GoogleWatchChannel,
    GoogleWatchConfig, OccurrenceRange, ProviderCalendar, StoredGoogleCalendar, VisibleCalendar,
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

    /// Patch the supplied fields of one occurrence of a recurring series,
    /// identified by its original start key, then refresh the series. An
    /// occurrence the provider does not have writes nothing and surfaces as
    /// [`GoogleInstanceUpdateOutcome::OccurrenceGone`] with the refreshed
    /// series, so a stale projection converges instead of mutating the
    /// master.
    fn update_event_instance(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
        patch: &CalendarEventPatch,
    ) -> impl Future<Output = Result<GoogleInstanceUpdateOutcome, GoogleProviderError>> + Send;

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

    /// Set the actor's own RSVP on an event. `actor` is the requester's
    /// owned-inbox identity. An event that no longer exists at the
    /// provider surfaces as [`GoogleRsvpOutcome::Gone`]; absence of a matching
    /// attendee surfaces as [`GoogleRsvpOutcome::NotAttendee`].
    ///
    /// `scope` selects what the response covers: the master for
    /// [`CalendarRsvpScope::All`], one exception instance for
    /// [`CalendarRsvpScope::ThisEvent`].
    fn rsvp_event(
        &self,
        access_token: &str,
        target: &GoogleCalendarTarget,
        master_provider_event_id: &str,
        actor: &ActorInboxes,
        response: AttendeeResponseStatus,
        scope: &CalendarRsvpScope,
    ) -> impl Future<Output = Result<GoogleRsvpOutcome, GoogleProviderError>> + Send;

    /// Close a push notification channel. A channel Google no longer knows
    /// about is success, since the goal is only that it stops delivering.
    fn stop_watch_channel(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        channel_id: &str,
        resource_id: &str,
    ) -> impl Future<Output = Result<(), GoogleProviderError>> + Send;
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

/// How much of a recurring series an RSVP applies to.
///
/// There is deliberately no this-and-following variant. The provider's Event
/// resource addresses an exception by `originalStartTime` — exactly one
/// instance — with no range field, so a forward response is inexpressible as
/// a provider write and could only be emulated by enumerating instances,
/// which an unbounded series never finishes. Both variants here are one
/// exact provider call that Google remains authoritative for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarRsvpScope {
    /// The entire series, recorded on the master.
    All,
    /// One occurrence, identified by its original start key.
    ThisEvent {
        /// Stable original-start key of the occurrence.
        recurrence_id: String,
    },
}

/// How much of a recurring series an update applies to.
///
/// Like [`CalendarRsvpScope`] there is deliberately no this-and-following
/// variant: the provider has no forward-scoped write, and emulating one the
/// way Google's own UI does — truncate the series, then insert a clone
/// carrying the edits — is two non-atomic provider writes whose first half
/// alone destroys every future occurrence, and the clone is a new provider
/// event that re-invites its attendees. Callers wanting that shape compose
/// it explicitly from a this-and-following deletion and a create.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CalendarUpdateScope {
    /// The entire event or series, written on the master. A time change
    /// here re-anchors a recurring series: every occurrence moves.
    All,
    /// One occurrence, identified by its original start key, written as a
    /// provider exception. The rest of the series stays untouched.
    ThisEvent {
        /// Stable original-start key of the occurrence.
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

/// Result of patching one occurrence of a recurring series.
pub enum GoogleInstanceUpdateOutcome {
    /// The occurrence was patched; the echo carries the refreshed series.
    Applied(Box<CalendarEventUpsert>),
    /// The provider has no such occurrence — nothing was written. The echo
    /// carries the series as the provider actually holds it, so the caller
    /// can converge a projection stale enough to list phantom occurrences.
    OccurrenceGone(Box<CalendarEventUpsert>),
    /// The whole series no longer exists at the provider.
    SeriesGone,
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

    /// Resolve mentioned events to the requester's own projections, one
    /// result per requested item in order.
    fn mention_previews(
        &self,
        requester_id: &str,
        items: Vec<CalendarMentionRequestItem>,
    ) -> impl Future<Output = Result<Vec<CalendarMentionPreview>, Report>> + Send;
}

/// What a write did to one event's canonical `calendar_events` row.
///
/// Reports the row's fate, not the caller's intent: an idempotent re-create
/// that lands on the upsert's conflict path is [`Updated`](Self::Updated), and
/// a write the sequence guard rejected is [`Unchanged`](Self::Unchanged).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarEventChange {
    /// The row was inserted.
    Created,
    /// The row was rewritten in place.
    Updated,
    /// Nothing was written: the incoming projection matched the stored one, or
    /// the sequence guard rejected it as stale.
    Unchanged,
}

/// One event's identity and what a write did to it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CalendarEventWriteOutcome {
    /// The canonical entity id the write applied to.
    pub event_id: Uuid,
    /// Owner of this per-user event projection.
    pub owner_id: String,
    /// What happened to the row.
    pub change: CalendarEventChange,
}

/// One event's fate after its sources were retired.
///
/// Retiring a source does not necessarily remove the event: the row survives,
/// rewritten from its next-best remaining source. Retiring a recurring
/// master's source also retires its expanded instances, so one call reports
/// several events.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RetiredCalendarEvent {
    /// The event whose sources were retired.
    pub event_id: Uuid,
    /// Owner of this per-user event projection.
    pub owner_id: String,
    /// Whether the row is now gone. `false` means it was rewritten from a
    /// remaining source.
    pub deleted: bool,
}

/// Persistence operations used by calendar business logic.
pub trait CalendarRepository: Send + Sync + 'static {
    /// Apply the actual scopes returned by Google and atomically schedule any
    /// newly unlocked historical work.
    ///
    /// `intent` decides how the grant meets a standing calendar opt-out: an
    /// explicit calendar request clears it, anything else is filtered through
    /// it so calendar scopes that merely rode along stay unrecorded.
    fn apply_google_grant(
        &self,
        email_link_id: Uuid,
        scopes: GoogleScopeSet,
        intent: CalendarGrantIntent,
    ) -> impl Future<Output = Result<AppliedGoogleGrant, Report>> + Send;

    /// Turn the calendar capability off for an inbox the requester owns:
    /// remove its calendar data, drop the calendar scopes from the recorded
    /// grant, and stamp the opt-out that keeps a later incidental re-grant
    /// from resurrecting it. Returns `None` when the requester owns no such
    /// inbox, and the still-open push channels otherwise.
    fn disconnect_google_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<Option<DisconnectedGoogleCalendar>, Report>> + Send;

    /// Upsert an event through an explicit, source-matched ingestion
    /// authority, reporting what the write did to the canonical row.
    fn upsert_event(
        &self,
        write: CalendarEventWrite,
    ) -> impl Future<Output = Result<CalendarEventWriteOutcome, Report>> + Send;

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

    /// Resolve mentioned events to the requester's own projections, one
    /// result per requested item in order. `now` anchors which occurrence a
    /// series previews when the mention names no instance.
    fn mention_previews(
        &self,
        requester_id: &str,
        items: Vec<CalendarMentionRequestItem>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<CalendarMentionPreview>, Report>> + Send;

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
    ) -> impl Future<Output = Result<Vec<RetiredCalendarEvent>, Report>> + Send;

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
    ) -> impl Future<Output = Result<Vec<RetiredCalendarEvent>, Report>> + Send;

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

    /// Addresses of every connected inbox the requester owns
    /// (`email_links.macro_id = requester`). Raw and unnormalized;
    /// [`ActorInboxes::from_owned`] is the single normalization point.
    fn owned_inbox_emails(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, Report>> + Send;

    /// Retire a Google source the provider confirmed deleted (a recurring
    /// master also retires its expanded instances), restoring the best
    /// surviving source or removing the entity, mirroring feed tombstones.
    /// Retire a provider source and reconcile every event it backed,
    /// reporting which of them survived on another source and which are gone.
    fn remove_google_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> impl Future<Output = Result<Vec<RetiredCalendarEvent>, Report>> + Send;
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

    /// Patch an event at its provider — the whole event or series, or one
    /// occurrence of a recurring series — and persist the echo.
    fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Delete an event at its provider — entirely, one occurrence, or from
    /// an occurrence onward — and reconcile the local projection.
    fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        scope: CalendarDeletionScope,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;

    /// Set the requester's inbox RSVP on an event — the whole series, one
    /// occurrence, or an occurrence onward — and persist the echo.
    fn respond_to_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Turn calendar off for one of the requester's own connected inboxes:
    /// its calendar data is removed, the calendar scopes leave the recorded
    /// grant, and its push channels are closed at Google.
    fn disconnect_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;
}

/// Use-case failures surfaced by calendar mutations.
#[derive(Debug, thiserror::Error)]
pub enum CalendarMutationError {
    /// The event does not exist or is not visible to the requester.
    #[error("calendar event was not found")]
    NotFound,
    /// The targeted occurrence does not exist on the recurring event at the
    /// provider; the local projection was refreshed to match the provider.
    #[error("the targeted occurrence was not found on the recurring event")]
    OccurrenceNotFound,
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

/// Dispatch use cases driven by the calendar reminder queue worker.
pub trait CalendarReminderDispatch: Send + Sync + 'static {
    /// Find due firings and fan one delivery message out per firing.
    fn sweep(&self) -> impl Future<Output = Result<CalendarReminderSweepSummary, Report>> + Send;

    /// Deliver one firing: revalidate, claim, notify, complete.
    fn deliver(
        &self,
        firing: CalendarReminderFiring,
    ) -> impl Future<Output = Result<CalendarReminderDeliveryOutcome, Report>> + Send;
}

/// Persistence the calendar reminder dispatcher runs on.
pub trait CalendarReminderDispatchRepo: Send + Sync + 'static {
    /// Scheduled firings inside the due window that have no completed
    /// delivery claim, ordered by `(fire_at, event_id, minutes_before,
    /// occurrence_key)` and capped at `limit` rows. `after` resumes the scan
    /// past a previous page's last firing, so a sweep drains an arbitrarily
    /// large backlog in bounded batches.
    fn due_reminder_firings(
        &self,
        now: DateTime<Utc>,
        after: Option<&CalendarReminderFiring>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<CalendarReminderFiring>, Report>> + Send;

    /// Re-resolve one swept firing against live state. `None` means the
    /// schedule moved on — the event changed, was cancelled, or its account
    /// went away — and the stale message must not deliver.
    fn find_due_reminder(
        &self,
        firing: &CalendarReminderFiring,
    ) -> impl Future<Output = Result<Option<DueCalendarReminder>, Report>> + Send;

    /// Claim the firing for delivery. The insert is the claim; a claim made
    /// before `retry_before` and never completed is taken over.
    fn claim_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
        retry_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;

    /// Hand an unfinished claim back so redelivery retries immediately.
    fn release_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Mark the claimed firing delivered.
    fn complete_reminder_delivery(
        &self,
        firing: &CalendarReminderFiring,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Notification egress for due calendar reminders.
pub trait CalendarReminderNotifier: Send + Sync + 'static {
    /// Send the reminder notification to the event owner.
    fn notify(&self, due: &DueCalendarReminder) -> impl Future<Output = Result<(), Report>> + Send;
}

/// A raw message received from the dispatch queue.
#[derive(Clone, Debug)]
pub struct RawCalendarDispatchMessage {
    /// Serialized [`CalendarReminderDispatchMessage`] body.
    pub body: String,
    /// Transport handle used to acknowledge the message.
    pub receipt_handle: String,
}

/// Transport carrying calendar reminder dispatch messages.
pub trait CalendarReminderDispatchQueue: Send + Sync + 'static {
    /// Publish fan-out messages, one per due firing.
    fn publish_batch(
        &self,
        messages: &[CalendarReminderDispatchMessage],
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Long-poll the queue for work.
    fn receive_messages(
        &self,
    ) -> impl Future<Output = Result<Vec<RawCalendarDispatchMessage>, Report>> + Send;

    /// Acknowledge one handled message.
    fn delete_message(
        &self,
        receipt_handle: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
