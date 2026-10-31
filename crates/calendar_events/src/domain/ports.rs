//! Ports implemented by calendar adapters.

use std::future::Future;

use chrono::{DateTime, Utc};
use rootcause::Report;
use uuid::Uuid;

use super::copies::{CopyChange, CopyRefusal};
use super::ics::{
    CalendarEventExport, CalendarEventForward, CalendarEventIcs, EventSnapshot, ForwardedCopy,
    IcsParticipant,
};
use super::join_requests::{CalendarJoinRequest, CalendarJoinRequestStatus};
use super::meeting_links::{
    CreateEventWithMacroCallError, MeetingLink, MeetingLinkError, MeetingLinkRequest,
};
use super::models::{
    ActorInboxes, AlignedGuestCopy, AppliedGoogleGrant, AttendeeResponseStatus, CalendarAttendee,
    CalendarAttendeeInput, CalendarBackfillClaim, CalendarBackfillFailureDisposition,
    CalendarBackfillFailureOutcome, CalendarBackfillJobKey, CalendarCreationTarget, CalendarEvent,
    CalendarEventDraft, CalendarEventMutationTarget, CalendarEventPatch, CalendarEventUpsert,
    CalendarGrantIntent, CalendarLinkTokenIdentity, CalendarMentionPreview,
    CalendarMentionRequestItem, CalendarOccurrenceCursor, CalendarReminderDeliveryOutcome,
    CalendarReminderDispatchMessage, CalendarReminderFiring, CalendarReminderSweepSummary,
    CalendarSyncStatus, DisconnectedCalendar, DueCalendarReminder, EventDetails,
    GoogleCalendarSyncSnapshot, GoogleEventSyncBatch, GoogleScopeSet, GoogleSyncPlan,
    GoogleWatchChannel, GoogleWatchConfig, GuestPolicy, MeetingCopy, OccurrenceListing,
    OccurrenceRange, OwnedInbox, ProviderCalendar, ProviderCalendarTarget, StoredGoogleCalendar,
    TeamOutOfOffice, VisibleCalendar,
};

/// Classification supplied by provider adapters to backfill policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalendarProviderErrorKind {
    /// Transport, throttling, timeout, or server failure that may recover.
    Transient,
    /// A permanent request failure unrelated to grant health.
    Permanent,
    /// The connected grant is invalid, revoked, or insufficient.
    ReauthRequired,
    /// The provider continuation token expired and requires a full resync.
    SyncTokenExpired,
    /// The provider will not open push channels for this resource; only
    /// polling can keep it in sync.
    PushUnsupported,
}

/// Typed calendar provider failure returned across the provider port.
#[derive(Debug, thiserror::Error)]
#[error("Calendar provider request failed: {message}")]
pub struct CalendarProviderError {
    kind: CalendarProviderErrorKind,
    message: String,
}

impl CalendarProviderError {
    /// Construct a classified provider failure.
    pub fn new(kind: CalendarProviderErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Return the retry/reauthorization classification.
    pub fn kind(&self) -> CalendarProviderErrorKind {
        self.kind
    }

    /// Return the provider failure detail, without the Display prefix.
    pub fn message(&self) -> &str {
        &self.message
    }
}

/// Stable identifiers and sync policy for one provider calendar fetch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GoogleEventSyncContext {
    /// Calendar identity and materialization window.
    pub target: ProviderCalendarTarget,
    /// Last continuation token committed for this provider calendar.
    pub sync_token: Option<String>,
    /// Domain-chosen reconciliation mode for this run.
    pub plan: GoogleSyncPlan,
}

/// Authorized ingestion command for one normalized calendar event.
pub enum CalendarEventWrite {
    /// Microsoft echo under an exact mailbox binding and renewable job lease.
    #[cfg(feature = "outlook")]
    OutlookSync {
        /// Current synchronization lease.
        lease: Box<super::outlook::OutlookCalendarLease>,
        /// Normalized provider echo.
        upsert: CalendarEventUpsert,
    },
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
pub trait CalendarMutationProvider: Send + Sync + 'static {
    /// Cancel an idempotent creation even if its acknowledgment was lost. Google
    /// uses the supplied ID; providers with assigned IDs resolve their correlation.
    fn delete_created_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        creation_key: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, CalendarProviderError>> + Send {
        async move {
            let id = super::models::creation_provider_id(creation_key, &target.owner_id);
            self.delete_event(access_token, target, &id).await?;
            Ok(vec![id])
        }
    }
    /// Insert a new event into the target calendar.
    fn create_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        draft: &CalendarEventDraft,
    ) -> impl Future<Output = Result<CalendarEventUpsert, CalendarProviderError>> + Send;

    /// Patch the supplied fields of an existing event. Returns `None` when
    /// the event no longer exists at the provider.
    fn update_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        provider_event_id: &str,
        patch: &CalendarEventPatch,
    ) -> impl Future<Output = Result<Option<CalendarEventUpsert>, CalendarProviderError>> + Send;

    /// Patch the supplied fields of one occurrence of a recurring series,
    /// identified by its original start key, then refresh the series. An
    /// occurrence the provider does not have writes nothing and surfaces as
    /// [`ProviderInstanceUpdateOutcome::OccurrenceGone`] with the refreshed
    /// series, so a stale projection converges instead of mutating the
    /// master.
    fn update_event_instance(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
        patch: &CalendarEventPatch,
    ) -> impl Future<Output = Result<ProviderInstanceUpdateOutcome, CalendarProviderError>> + Send;

    /// Read an event's series back from the target calendar, as after a
    /// write through another of its copies. Returns `None` when the copy no
    /// longer exists or was cancelled at the provider.
    fn refresh_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
    ) -> impl Future<Output = Result<Option<CalendarEventUpsert>, CalendarProviderError>> + Send;

    /// Delete an event. An event already gone at the provider is success.
    fn delete_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        provider_event_id: &str,
    ) -> impl Future<Output = Result<(), CalendarProviderError>> + Send;

    /// Delete one occurrence of a recurring series, identified by its
    /// original start key, then refresh the series. An occurrence already
    /// gone at the provider refreshes without deleting.
    fn delete_event_instance(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> impl Future<Output = Result<ProviderSeriesMutationOutcome, CalendarProviderError>> + Send;

    /// End a recurring series just before the identified occurrence,
    /// deleting the series outright when nothing would remain.
    fn truncate_recurring_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        original_start: &str,
    ) -> impl Future<Output = Result<ProviderSeriesMutationOutcome, CalendarProviderError>> + Send;

    /// Set the actor's own RSVP on an event. `actor` is the requester's
    /// owned-inbox identity. An event that no longer exists at the
    /// provider surfaces as [`ProviderRsvpOutcome::Gone`]; absence of a matching
    /// attendee surfaces as [`ProviderRsvpOutcome::NotAttendee`].
    ///
    /// `scope` selects what the response covers: the master for
    /// [`CalendarRsvpScope::All`], one exception instance for
    /// [`CalendarRsvpScope::ThisEvent`].
    fn rsvp_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        actor: &ActorInboxes,
        response: AttendeeResponseStatus,
        scope: &CalendarRsvpScope,
    ) -> impl Future<Output = Result<ProviderRsvpOutcome, CalendarProviderError>> + Send;

    /// Add guests to the master ([`CalendarUpdateScope::All`]) or one
    /// occurrence ([`CalendarUpdateScope::ThisEvent`]), keeping every guest
    /// already invited with their answer, notify the new guests, and refresh
    /// the series.
    ///
    /// `actor` is the inbox the addressed copy syncs through. The provider
    /// event is read first: a vanished event surfaces as
    /// [`ProviderInviteOutcome::Gone`], an actor who neither organizes nor
    /// attends it as [`ProviderInviteOutcome::NotAttendee`], and a guest the
    /// event's live policy refuses as [`ProviderInviteOutcome::Forbidden`] or
    /// [`ProviderInviteOutcome::GuestListHidden`]. Outlook takes guests only
    /// from the organizer, so it refuses anyone else with a permanent
    /// provider error. Guests already on the event are dropped, and nothing
    /// is written when none remain.
    fn add_attendees(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        master_provider_event_id: &str,
        actor: &ActorInboxes,
        guests: &[CalendarAttendeeInput],
        scope: &CalendarUpdateScope,
    ) -> impl Future<Output = Result<ProviderInviteOutcome, CalendarProviderError>> + Send;

    /// Import a snapshot of another calendar's event into the target
    /// calendar under the source's iCalendar UID: the meeting's organizer
    /// and content, with the calendar's owner as its only guest, since
    /// Google imports an event only for its organizer or an attendee. No one
    /// is notified: the meeting's guests are left out and an import sends
    /// nothing.
    ///
    /// Imports nothing when the calendar already holds a live event with
    /// that UID ([`ProviderImportOutcome::AlreadyHeld`]). Google's import
    /// updates such an event in place, which would strip the guests and join
    /// link of an invitation Macro has not synced yet.
    fn import_event(
        &self,
        access_token: &str,
        target: &ProviderCalendarTarget,
        source: &EventSnapshot,
    ) -> impl Future<Output = Result<ProviderImportOutcome, CalendarProviderError>> + Send;

    /// Close a push notification channel. A channel Google no longer knows
    /// about is success, since the goal is only that it stops delivering.
    fn stop_watch_channel(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        channel_id: &str,
        resource_id: &str,
    ) -> impl Future<Output = Result<(), CalendarProviderError>> + Send;
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
pub enum ProviderSeriesMutationOutcome {
    /// The series survives; the echo carries its refreshed state.
    Applied(Box<CalendarEventUpsert>),
    /// The provider no longer has any of the series.
    SeriesDeleted,
    /// The series master vanished before the mutation could apply.
    Gone,
}

/// Result of patching one occurrence of a recurring series.
pub enum ProviderInstanceUpdateOutcome {
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
pub enum ProviderRsvpOutcome {
    /// A successful response removed the attendee copy from the provider calendar.
    RespondedAndRemoved(Box<CalendarEvent>),
    /// The RSVP was applied; the echo carries the refreshed event.
    Applied(Box<CalendarEventUpsert>),
    /// The connected account is not an attendee of the event.
    NotAttendee,
    /// The event no longer exists at the provider.
    Gone,
}

/// Result of adding guests to an event.
pub enum ProviderInviteOutcome {
    /// The guests were added, or were already on the event; the echo carries
    /// the refreshed event.
    Applied(Box<CalendarEventUpsert>),
    /// The targeted occurrence is gone from the series; nothing was written,
    /// and the echo carries the provider's current series.
    OccurrenceGone(Box<CalendarEventUpsert>),
    /// The connected account neither organizes nor attends the event.
    NotAttendee,
    /// The organizer does not let this guest add guests. Carries the policy
    /// the provider reported, for the stored copy to follow.
    Forbidden(GuestPolicy),
    /// The organizer hides the guest list from guests. Carries the policy the
    /// provider reported, for the stored copy to follow.
    GuestListHidden(GuestPolicy),
    /// The event no longer exists at the provider.
    Gone,
}

/// Result of importing a snapshot of a shared event.
pub enum ProviderImportOutcome {
    /// The snapshot was imported; the echo carries the new event.
    Imported(Box<CalendarEventUpsert>),
    /// The calendar already holds a live event under the meeting's UID;
    /// nothing was imported.
    AlreadyHeld,
    /// The provider refused to import the snapshot into this calendar.
    Refused(CalendarProviderError),
}

/// Confirms which copy of a meeting a caller changes when the meeting is on
/// several of the requester's own inboxes, for callers that must name it.
pub trait CalendarCopyConfirmation: Send + Sync + 'static {
    /// `Some` refusal, listing each copy, when `event_id` is one of several
    /// inboxes' copies of its meeting and `inbox` does not name the inbox
    /// holding it (see [`crate::domain::copies::check_copy`]); `None` to go
    /// ahead.
    fn confirm_copy(
        &self,
        requester_id: &str,
        event_id: Uuid,
        inbox: Option<&str>,
        change: CopyChange,
    ) -> impl Future<Output = Result<Option<CopyRefusal>, CalendarMutationError>> + Send;
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
    ) -> impl Future<Output = Result<Vec<OccurrenceListing>, Report>> + Send;

    /// Return the aggregate ingestion state of the requester's visible accounts.
    fn sync_status(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<CalendarSyncStatus, Report>> + Send;

    /// List every calendar visible to the requester across owned and
    /// delegated inboxes, primaries and writables first.
    fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Vec<VisibleCalendar>, Report>> + Send;

    /// Resolve mentioned events to the requester's own projections, one
    /// result per requested item in order.
    fn mention_previews(
        &self,
        requester_id: &str,
        items: Vec<CalendarMentionRequestItem>,
    ) -> impl Future<Output = Result<Vec<CalendarMentionPreview>, Report>> + Send;

    /// Return teammates' out-of-office occurrences overlapping the viewport,
    /// soonest first, with title visibility policy already applied.
    fn list_team_out_of_office(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<TeamOutOfOffice>, Report>> + Send;

    /// The IANA time zone of the requester's primary calendar, resolved the
    /// same way event creation picks its default target. `None` when no
    /// calendar is connected or the provider reported no zone.
    fn primary_time_zone(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Option<String>, Report>> + Send;

    /// Every copy of `event_id`'s meeting the requester holds through one of
    /// their own inboxes, so a caller can tell when one meeting sits on
    /// several of them.
    fn meeting_copies(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MeetingCopy>, Report>> + Send;

    /// Render an event the requester can see — their own, or one shared with
    /// a channel they belong to — as an iCalendar document, with its title.
    /// `None` when the event does not exist or is not visible to them.
    fn event_ics(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarEventIcs>, Report>> + Send;
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
    /// A changed source was or is OOO; it may revoke a teammate's status/title.
    pub team_ooo_changed: bool,
    /// Guest copies of the same meeting, in any inbox Macro holds, whose
    /// guest policy changed to follow this copy's organizer. Their viewers
    /// need a refresh too.
    pub aligned_copies: Vec<AlignedGuestCopy>,
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
    fn disconnect_provider_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<Option<DisconnectedCalendar>, Report>> + Send;

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
    ) -> impl Future<Output = Result<Vec<OccurrenceListing>, Report>> + Send;

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

    /// Every copy of `event_id`'s meeting (same iCalendar UID) the requester
    /// holds through an inbox they own or have linked, ordered by inbox.
    /// Cancelled copies are left out, and an event they hold no copy of
    /// yields none.
    fn meeting_copies(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Vec<MeetingCopy>, Report>> + Send;

    /// Series content of an event the requester can see, for export or
    /// copying, with how they see it: the requester's own projection of the
    /// meeting (same iCalendar UID) on one of their own or linked calendars,
    /// else the requested row itself when it is neither private nor
    /// confidential and was shared with a channel they currently belong to.
    /// `None` covers an unknown or cancelled event and one they cannot see.
    fn event_export(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarEventExport>, Report>> + Send;

    /// What the requester's own `event_id` copy shows about where its
    /// invitation came from, and its conference link, for forwarding it.
    /// `None` when the requester owns no live copy by that id.
    fn forwarded_copy(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Option<ForwardedCopy>, Report>> + Send;

    /// Record a pending request from the requester to join `event_id`,
    /// leaving an existing one, whatever its status, as it is. Returns the
    /// request and whether this call created it, so a repeated ask does not
    /// notify the sharer twice.
    fn open_join_request(
        &self,
        event_id: Uuid,
        requester_id: &str,
        requester_email: &str,
    ) -> impl Future<Output = Result<(CalendarJoinRequest, bool), Report>> + Send;

    /// The requester's request to join `event_id`, whatever its status.
    fn find_join_request(
        &self,
        event_id: Uuid,
        requester_id: &str,
    ) -> impl Future<Output = Result<Option<CalendarJoinRequest>, Report>> + Send;

    /// Pending requests to join an event, oldest first.
    fn list_pending_join_requests(
        &self,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CalendarJoinRequest>, Report>> + Send;

    /// One join request by id.
    fn get_join_request(
        &self,
        request_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarJoinRequest>, Report>> + Send;

    /// Move a pending request to `status`. `None` when the request is gone
    /// or already answered, so two answers at once resolve it once. An
    /// acceptance is recorded only after its invitation was written, so it
    /// also overrides a decline that landed meanwhile: the stored status
    /// then matches the guest list.
    fn resolve_join_request(
        &self,
        request_id: Uuid,
        status: CalendarJoinRequestStatus,
    ) -> impl Future<Output = Result<Option<CalendarJoinRequest>, Report>> + Send;

    /// Out-of-office occurrences owned by the requester's teammates — the
    /// other members of the requester's team — overlapping the viewport,
    /// soonest first, sourced from a primary calendar on an account that is
    /// not disabled. The same provider event synced through more than one of
    /// a teammate's inboxes collapses to one row before the limit applies,
    /// so callers can detect truncation by row count. Titles arrive
    /// unmasked; the domain service owns the visibility policy.
    ///
    /// "Team" is singular by schema: `team_user` is unique per user, so the
    /// membership lookup cannot span teams. Relaxing that constraint would
    /// silently widen this query to every team the requester belongs to —
    /// revisit it together with any multi-team migration.
    fn list_team_out_of_office(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<TeamOutOfOffice>, Report>> + Send;

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

    /// Record a provider failure isolated to one calendar under the backfill's
    /// fencing token: store the message, stamp the time, and bump the
    /// consecutive-failure counter that gates whether the failure surfaces to
    /// the user. The calendar's sync state is left untouched so the next poll
    /// retries it. A successful `commit_google_calendar_sync` clears all three.
    fn record_google_calendar_sync_error(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar_id: Uuid,
        message: &str,
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

    /// Record that the provider refused a push channel for one calendar,
    /// under the backfill's fencing token.
    fn record_watch_unsupported(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        calendar_id: Uuid,
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

    /// Resolve an event visible to the requester to the Google source a
    /// mutation must address — the copy on `calendar_id` when one is named,
    /// else the canonical source — and the connected inbox that can mutate
    /// it. `None` covers an unknown event, one the requester cannot see, and
    /// a calendar that holds no copy of it.
    fn get_event_mutation_target(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
    ) -> impl Future<Output = Result<Option<CalendarEventMutationTarget>, Report>> + Send;

    /// The stored attendees of a canonical event. Used to carry each retained
    /// attendee's RSVP and optional state forward when a mutation replaces the
    /// attendee list, so adding or dropping one guest does not reset the rest.
    fn get_event_attendees(
        &self,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CalendarAttendee>, Report>> + Send;

    /// The override attendees of one occurrence, when it carries its own list.
    /// `None` means the occurrence inherits the series attendees; `Some` (even
    /// empty) is the occurrence's authoritative list, whose per-instance RSVPs
    /// must win over the series when an occurrence-scoped mutation replaces the
    /// attendee list.
    fn get_occurrence_override_attendees(
        &self,
        event_id: Uuid,
        recurrence_id: &str,
    ) -> impl Future<Output = Result<Option<Vec<CalendarAttendee>>, Report>> + Send;

    /// The stored details of a canonical event, or of one occurrence when
    /// `occurrence_key` names it: the occurrence's own content and time where
    /// it overrides the series. `None` covers an unknown event.
    fn get_event_details(
        &self,
        event_id: Uuid,
        occurrence_key: Option<&str>,
    ) -> impl Future<Output = Result<Option<EventDetails>, Report>> + Send;

    /// Store the guest policy the provider reported when it refused an
    /// invite, on the entity and every copy's projection. Incremental sync
    /// resends only changed events, so the stored policy can predate the
    /// organizer's choice.
    fn record_guest_policy(
        &self,
        event_id: Uuid,
        policy: GuestPolicy,
    ) -> impl Future<Output = Result<(), Report>> + Send;

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

    /// The IANA time zone of the requester's primary calendar, resolved the
    /// same way [`get_creation_target`](Self::get_creation_target) picks its
    /// default target.
    fn primary_time_zone(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Option<String>, Report>> + Send;

    /// Every connected inbox the requester owns
    /// (`email_links.macro_id = requester`). Raw and unnormalized;
    /// [`ActorInboxes::from_owned`] is the single normalization point.
    fn owned_inboxes(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<Vec<OwnedInbox>, Report>> + Send;

    /// Retire a Google source the provider confirmed deleted (a recurring
    /// master also retires its expanded instances), restoring the best
    /// surviving source or removing the entity, mirroring feed tombstones.
    /// Retire a provider source and reconcile every event it backed,
    /// reporting which of them survived on another source and which are gone.
    fn remove_provider_source(
        &self,
        account_id: Uuid,
        calendar_id: Uuid,
        provider_event_id: &str,
    ) -> impl Future<Output = Result<Vec<RetiredCalendarEvent>, Report>> + Send;
}

/// Tells the person who shared an event that a channel member asked to join
/// it. Best effort: implementations log and drop delivery failures, since
/// the request is already recorded and shows on the event.
pub trait CalendarJoinRequestNotifier: Send + Sync + 'static {
    /// Notify `sharer_id` about a request that just became pending.
    fn notify_join_request(
        &self,
        sharer_id: &str,
        request: &CalendarJoinRequest,
        event_title: &str,
    ) -> impl Future<Output = ()> + Send;
}

/// Failures asking to join a shared event or listing its requests.
#[derive(Debug, thiserror::Error)]
pub enum CalendarJoinRequestError {
    /// The event does not exist or is not visible to the requester.
    #[error("calendar event was not found")]
    NotFound,
    /// The meeting is already on one of the requester's calendars.
    #[error("the event is already on one of the requester's calendars")]
    AlreadyOnCalendar,
    /// The sharer's copy does not let them add guests, so they could not
    /// accept.
    #[error("the person who shared this event cannot add guests to it")]
    SharerCannotInvite,
    /// The sharer declined the requester's earlier request, which stands.
    #[error("the person who shared this event declined the request to join")]
    Declined,
    /// Persistence failed.
    #[error("calendar join request failed: {0}")]
    Internal(Report),
}

/// Inbound service port for asking to join an event shared with a channel
/// and for sharers reading the requests on their events.
pub trait CalendarJoinRequestService: Send + Sync + 'static {
    /// Ask the person who shared an event with one of the requester's
    /// channels to add them as a guest, notifying them when the request
    /// becomes pending. Asking again while pending changes nothing; asking
    /// after a decline is refused with `Declined`, so the sharer is asked
    /// only once.
    fn request_to_join(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<CalendarJoinRequest, CalendarJoinRequestError>> + Send;

    /// Pending requests on an event the requester can change.
    fn list_join_requests(
        &self,
        requester_id: &str,
        event_id: Uuid,
    ) -> impl Future<Output = Result<Vec<CalendarJoinRequest>, CalendarJoinRequestError>> + Send;
}

/// Outbound port that nudges a connected inbox's calendar viewers — the link
/// owner plus its delegates — to refetch their calendar projections after a
/// Macro-originated mutation changed them. Best effort: implementations log
/// and swallow delivery failures, since the mutation is already committed.
pub trait CalendarRefreshNotifier: Send + Sync + 'static {
    /// Signal that `email_link_id`'s calendar projection changed. Only pass
    /// `team_ooo_changed: false` when the change cannot affect team OOO access.
    fn calendar_changed(
        &self,
        owner_id: &str,
        email_link_id: Uuid,
        team_ooo_changed: bool,
    ) -> impl Future<Output = ()> + Send;
}

/// Outbound port that announces one connected inbox's Google grant has gone
/// dead and needs reconnection. The notification itself — reconnect-your-inbox
/// email, `email.link_reauth_required` topic event, activity row — is owned by
/// email_service's link-manager consumer; calendar_service backs this port by
/// enqueuing onto the shared link-manager queue that consumer already drains.
/// Best effort at the edge: the announcer logs and swallows a delivery failure,
/// since the failure the notification describes is already durably recorded.
pub trait CalendarReauthNotifier: Send + Sync + 'static {
    /// Announce that `email_link_id`'s grant requires reauthorization.
    fn notify_reauth_required(
        &self,
        email_link_id: Uuid,
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

    /// Patch an event at its provider — the whole event or series, or one
    /// occurrence of a recurring series — and persist the echo. `calendar_id`
    /// selects which copy of a multi-calendar event is patched. `None`
    /// addresses the canonical source.
    fn update_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Delete an event at its provider — entirely, one occurrence, or from
    /// an occurrence onward — and reconcile the local projection.
    fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        scope: CalendarDeletionScope,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;

    /// Set the requester's inbox RSVP on an event — the whole series, one
    /// occurrence, or an occurrence onward — and persist the echo.
    fn respond_to_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
        responding_email: Option<String>,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Add guests to an event — the whole event or series, or one occurrence
    /// — without touching anyone already invited, and persist the echo. A
    /// guest may do this when the organizer lets guests invite others.
    fn invite_guests(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        guests: Vec<CalendarAttendeeInput>,
        scope: CalendarUpdateScope,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Add a snapshot of an event shared with one of the requester's
    /// channels to one of their Google calendars — the selected one, or
    /// their primary inbox's primary calendar — and persist the provider
    /// echo. The snapshot keeps the meeting's iCalendar UID, so it becomes
    /// the requester's own projection of that meeting.
    fn copy_shared_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;

    /// Answer a request to join an event the requester can change.
    /// Accepting adds the asker as a guest through
    /// [`invite_guests`](Self::invite_guests), so the provider invites them;
    /// declining only records the answer. A request that is no longer pending
    /// is returned unchanged.
    fn respond_to_join_request(
        &self,
        requester_id: &str,
        request_id: Uuid,
        accept: bool,
    ) -> impl Future<Output = Result<CalendarJoinRequest, CalendarMutationError>> + Send;

    /// Turn calendar off for one of the requester's own connected inboxes:
    /// its calendar data is removed, the calendar scopes leave the recorded
    /// grant, and its push channels are closed at Google.
    fn disconnect_calendar(
        &self,
        requester_id: &str,
        email_link_id: Uuid,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;
}

/// Inbound service port adding an event the requester holds as an
/// iCalendar file, such as one forwarded to them by email, to one of their
/// Google calendars.
pub trait CalendarSnapshotImporter: Send + Sync + 'static {
    /// Import `snapshot` into the selected calendar, or the requester's
    /// primary inbox's primary calendar, the way
    /// [`CalendarMutationService::copy_shared_event`] adds a channel share:
    /// under the meeting's iCalendar UID, with the calendar as its only guest,
    /// notifying no one. The caller has already authorized the file.
    fn import_snapshot(
        &self,
        requester_id: &str,
        snapshot: EventSnapshot,
        calendar_id: Option<Uuid>,
    ) -> impl Future<Output = Result<CalendarEvent, CalendarMutationError>> + Send;
}

/// Inbound service port reading what forwarding one of the requester's
/// events by email sends, for the host that sends the email.
pub trait CalendarEventForwardSource: Send + Sync + 'static {
    /// The requester's own copy of `event_id` as an iCalendar document for
    /// a forward to `invitees`, with the inbox holding that copy, which
    /// sends it, and whether the document is an invitation naming them or
    /// the shared-event file. `None` when the event is cancelled, unknown,
    /// or not held through one of their own inboxes.
    fn event_forward(
        &self,
        requester_id: &str,
        event_id: Uuid,
        invitees: &[IcsParticipant],
    ) -> impl Future<Output = Result<Option<CalendarEventForward>, Report>> + Send;
}

/// Inbound service port creating events that carry a Macro call.
///
/// The meeting is minted before the calendar write, so the one invitation
/// attendees receive already names the call, and its join link travels in
/// the event's description and location. Hosts that mint meetings compose a
/// [`CalendarMutationService`] with a [`MeetingLinkProvider`] through
/// [`super::meeting_links::create_event_with_macro_call`]; hosts that are
/// not the calendar write authority forward the request to the calendar
/// service.
pub trait CalendarMacroCallService: Send + Sync + 'static {
    /// Mint a Macro call for `draft` and create the event carrying its link.
    fn create_event_with_macro_call(
        &self,
        requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> impl Future<Output = Result<CalendarEvent, CreateEventWithMacroCallError>> + Send;
}

/// Outbound port minting Macro meetings for calendar events.
///
/// Implementations act as the requester: the meeting is owned by the user
/// whose event carries it, so only they can later edit or cancel it.
pub trait MeetingLinkProvider: Send + Sync + 'static {
    /// Mint a meeting the requester owns and return its join link.
    fn create_meeting_link(
        &self,
        requester_id: &str,
        request: MeetingLinkRequest,
    ) -> impl Future<Output = Result<MeetingLink, MeetingLinkError>> + Send;

    /// Cancel a meeting the requester owns. Used to roll back a meeting
    /// whose event never got written.
    fn cancel_meeting_link(
        &self,
        requester_id: &str,
        meeting_id: Uuid,
    ) -> impl Future<Output = Result<(), MeetingLinkError>> + Send;
}

/// Unwired meeting-link port for hosts that expose calendar operations but
/// have no call service. Every method fails with
/// [`MeetingLinkError::Unavailable`], so an event asking for a Macro call
/// is refused before anything reaches the calendar.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnavailableMeetingLinks;

impl MeetingLinkProvider for UnavailableMeetingLinks {
    async fn create_meeting_link(
        &self,
        _requester_id: &str,
        _request: MeetingLinkRequest,
    ) -> Result<MeetingLink, MeetingLinkError> {
        Err(MeetingLinkError::Unavailable)
    }

    async fn cancel_meeting_link(
        &self,
        _requester_id: &str,
        _meeting_id: Uuid,
    ) -> Result<(), MeetingLinkError> {
        Err(MeetingLinkError::Unavailable)
    }
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
    /// Only the organizer may change the event's guest policy.
    #[error("only the organizer can change guest permissions")]
    NotOrganizer,
    /// Only the organizer may invite guests: the organizer does not let
    /// guests invite others, or the event is an Outlook meeting, which
    /// gives its attendees no way to change it.
    #[error("only the organizer can invite guests to this event")]
    GuestsCannotInvite,
    /// The organizer hides the guest list, so a guest's copy cannot hold the
    /// whole list a guest addition must write.
    #[error("guests cannot be added while the organizer hides the guest list")]
    GuestListHidden,
    /// The organizer does not let guests change the event's details.
    #[error("the organizer doesn't let guests change this event")]
    GuestsCannotModify,
    /// The meeting is already on one of the requester's calendars.
    #[error("the event is already on one of the requester's calendars")]
    AlreadyOnCalendar,
    /// The requester asked to join the shared event and the request is
    /// pending or accepted, so the meeting reaches their calendar as an
    /// invitation; a snapshot added meanwhile would take that invitation in.
    #[error("the requester has asked to join this event")]
    JoinRequestOpen,
    /// The provider refused to add a copy of the event to the calendar.
    #[error("the calendar provider refused to add a copy of the event: {0}")]
    CopyRefused(String),
    /// The event is a snapshot of a shared meeting, so an answer or a new
    /// guest would never reach the meeting.
    #[error("the event is a snapshot of a shared meeting")]
    Snapshot,
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
    ) -> impl Future<Output = Result<Vec<ProviderCalendar>, CalendarProviderError>> + Send;

    /// Poll provider changes and, when needed, rebuild the bounded event snapshot.
    fn sync_events(
        &self,
        access_token: &str,
        context: GoogleEventSyncContext,
    ) -> impl Future<Output = Result<GoogleEventSyncBatch, CalendarProviderError>> + Send;

    /// Open a push notification channel for one provider calendar.
    fn watch_calendar(
        &self,
        access_token: &str,
        email_link_id: Uuid,
        provider_calendar_id: &str,
        channel_id: Uuid,
        config: &GoogleWatchConfig,
    ) -> impl Future<Output = Result<GoogleWatchChannel, CalendarProviderError>> + Send;
}

/// Durable scheduling operations for periodic provider maintenance.
pub trait GoogleCalendarSyncRepository: Send + Sync + 'static {
    /// Reset completed current-grant jobs that are due for another incremental poll.
    fn schedule_due_google_syncs(
        &self,
        due_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<usize, Report>> + Send;

    /// Re-arm current-grant jobs stranded off the queue: `pending` jobs whose
    /// outbox row is already published yet went untouched since `stalled_before`
    /// (a deterministic delivery that dead-lettered), and `running` jobs whose
    /// lease expired before `stalled_before` (a worker that died mid-run).
    /// Republishing the outbox row lets the drain redeliver them.
    fn reap_wedged_google_syncs(
        &self,
        stalled_before: DateTime<Utc>,
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

    /// Mark the account as actively syncing after a successful claim, preserving
    /// any prior failure until successful completion establishes healthy coverage.
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

    /// Record when the event's latest reminder notification was delivered, so
    /// recency-sorted listings surface the event at delivery time instead of
    /// its last-modified time.
    fn record_reminder_fired(
        &self,
        event_id: Uuid,
        fired_at: DateTime<Utc>,
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

/// Recovery capability for callers that persist a creation key and its target calendar.
pub trait CalendarCreationRecoveryService: CalendarMutationService {
    /// Delete a keyed event even if a previous deletion already retired its local projection.
    /// The current requester must still own a writable grant to the pinned calendar.
    fn delete_created_event(
        &self,
        requester_id: &str,
        calendar_id: Uuid,
        creation_key: Uuid,
    ) -> impl Future<Output = Result<(), CalendarMutationError>> + Send;
}
