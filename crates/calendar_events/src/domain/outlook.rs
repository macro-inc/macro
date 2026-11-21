//! Durable Outlook calendar synchronization, independent of Google's grant jobs.

/// Explicit, durable out-of-office invitation response policy.
pub mod automatic_decline;
use super::{models::*, ports::*};
use automatic_decline::{AutomaticDeclineProvider, AutomaticDeclineRepository};
use rootcause::Report;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// One lease on an account discovery or calendar synchronization job.
#[derive(Clone)]
pub struct OutlookCalendarLease {
    /// Durable work identifier.
    pub id: Uuid,
    /// Compare-and-swap lease identity.
    pub lease_id: Uuid,
    /// Current credential binding.
    pub binding: CalendarGrantBinding,
    /// Connected account identity.
    pub account_id: Uuid,
    /// Owner of normalized projections.
    pub owner_id: String,
    /// Token identity checked by authentication on every acquisition.
    pub token_identity: CalendarLinkTokenIdentity,
    /// Absent for calendar discovery; present for event synchronization.
    pub target: Option<ProviderCalendarTarget>,
    /// Whether this calendar is the account's default calendar.
    pub is_primary: bool,
    /// Opaque delta URL, never logged or interpreted.
    pub cursor: Option<String>,
    /// Acknowledged page awaiting individual event refreshes.
    pub pending_ids: Vec<String>,
    /// Whether the current page is durable and awaiting completion.
    pub page_loaded: bool,
    /// Opaque current-page URL.
    pub page_cursor: Option<String>,
    /// Whether the current page chain lists only this month and next
    /// ([`OccurrenceRange::near_window`]): a calendar's first import reads
    /// them before its whole window, so what the user looks at first arrives
    /// first. Nothing counts as synced until the whole window is read.
    pub near_window: bool,
    /// [`OutlookCalendarReader::READER_REVISION`] of the worker holding the
    /// lease, which every event it reads is stamped with.
    pub reader_revision: i16,
    /// Whether the calendar is a system calendar
    /// ([`OutlookCalendar::is_system`]), whose next round is due a day after
    /// one finishes rather than two minutes.
    pub system_calendar: bool,
}

/// Complete discovery result for a provider calendar.
pub struct OutlookCalendar {
    /// Shared calendar metadata.
    pub calendar: ProviderCalendar,
    /// Meeting providers actually allowed by this calendar.
    pub online_meeting_providers: Vec<String>,
    /// Who created or added the calendar, or shared it with the mailbox.
    pub owner_address: Option<String>,
    /// Whether someone shared the calendar with the mailbox.
    pub shared_with_me: bool,
}

impl OutlookCalendar {
    /// Whether this is one of the mailbox's own read-only system calendars,
    /// such as its holidays or Birthdays calendar, which sync once a day
    /// ([`SYSTEM_CALENDAR_SYNC_INTERVAL`]) as Google's system calendars do.
    /// A read-only calendar someone shared with the mailbox is someone's
    /// schedule and keeps the normal cadence.
    pub fn is_system(&self, mailbox_address: &str) -> bool {
        self.calendar.access_role.as_deref() == Some("reader")
            && !self.calendar.is_primary
            && !self.shared_with_me
            && self
                .owner_address
                .as_deref()
                .is_some_and(|owner| owner.eq_ignore_ascii_case(mailbox_address))
    }
}

/// What a claim changed about the account's calendars, for their viewers: a
/// discovery's calendars, or a calendar's sync error badge.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OutlookCalendarsChange {
    /// A calendar was added, removed or changed, so viewers refetch.
    pub changed: bool,
    /// The change may move teammates' out-of-office rows: a discovery's
    /// calendar changes, by the rule Google's calendar list follows, or a
    /// sync error badge.
    pub team_ooo_changed: bool,
}

impl OutlookCalendarsChange {
    /// A calendar's sync error badge showed, changed or cleared. Its sync
    /// failures are a coverage failure for teammates' out-of-office rows,
    /// which leave out an account or calendar with a stored error from its
    /// first failure, so the hint cannot certify their rows unchanged.
    const SYNC_ERROR_BADGE: Self = Self {
        changed: true,
        team_ooo_changed: true,
    };
}

/// Every calendar one Outlook account can see.
pub struct OutlookDiscovery {
    /// The account's calendars, each in the mailbox's time zone.
    pub calendars: Vec<OutlookCalendar>,
    /// The mailbox time zone Microsoft named when Macro cannot map it to an
    /// IANA zone. The calendars then carry no time zone rather than failing
    /// discovery, and every reader treats it as unknown, as it does a Google
    /// calendar zone it cannot read.
    pub unmapped_time_zone: Option<String>,
}

/// One occurrence or single event a page lists.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutlookPageMember {
    /// Provider occurrence/single ID.
    pub provider_id: String,
    /// Normalized master/single ID.
    pub master_id: String,
    /// Its start and end, when the listing carries a time Macro can read.
    pub occurs: Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>,
}

/// The master/single IDs a first import's near-window page lists, each once,
/// in the order it reads them: the event closest to `now` first, so this week
/// arrives before the rest of the two months. A series counts by its nearest
/// listed occurrence and an event under way is at distance zero. Members
/// without a readable time come last, by ID, the order every other page reads.
pub fn nearest_first(
    members: &[OutlookPageMember],
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<String> {
    let mut nearest = std::collections::BTreeMap::<&str, Option<chrono::TimeDelta>>::new();
    for member in members {
        let distance = member.occurs.map(|(starts_at, ends_at)| {
            if now < starts_at {
                starts_at - now
            } else if now < ends_at {
                chrono::TimeDelta::zero()
            } else {
                now - ends_at
            }
        });
        let entry = nearest.entry(&member.master_id).or_insert(distance);
        *entry = match (*entry, distance) {
            (Some(known), Some(distance)) => Some(known.min(distance)),
            (known, distance) => known.or(distance),
        };
    }
    let mut order: Vec<_> = nearest.into_iter().collect();
    order.sort_by_key(|(_, distance)| (distance.is_none(), *distance));
    order.into_iter().map(|(id, _)| id.to_owned()).collect()
}

/// One page of event identities. Its cursor is staged with its child work.
pub struct OutlookCalendarPage {
    /// The occurrences and single events listed.
    pub members: Vec<OutlookPageMember>,
    /// Tombstoned provider occurrence/single IDs.
    pub removed: Vec<String>,
    /// Next page URL, when this round is not complete.
    pub next: Option<String>,
    /// Terminal delta URL for the primary calendar.
    pub delta: Option<String>,
}
/// A durable step in an Outlook calendar backfill or delta round.
pub enum OutlookCalendarProgress {
    /// Save a provider page and its child work before making further calls.
    Page(OutlookCalendarPage),
    /// A normalized echo has been committed, or the event is confirmed absent.
    Event {
        /// Master/single ID from this lease's pending work.
        id: String,
        /// Whether the current provider event still exists.
        exists: bool,
    },
    /// The event exists but Macro cannot read it. Retire any copy stored
    /// before, which would show a version Microsoft no longer has, but keep
    /// the event's page membership so later tombstones still resolve. A
    /// reader of a later revision reads it again on its next delta round.
    Unreadable {
        /// Master/single ID from this lease's pending work.
        id: String,
    },
    /// Finish a page, or atomically prune and commit the terminal cursor.
    Finish,
    /// Restart an expired or unresolvable delta with a new full snapshot.
    Reset,
}

/// What a committed checkpoint completed besides its own step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutlookCheckpoint {
    /// A step inside a round, or the end of one of its pages.
    Step,
    /// A first import's near window is in; the whole window is listed next.
    NearWindowImported,
    /// The round finished and the calendar is synced.
    RoundFinished {
        /// Whether this was the calendar's first sync.
        first_sync: bool,
        /// Whether the round cleared a sync error badge the calendar showed.
        cleared_sync_error: bool,
    },
}

/// One provider event read back for synchronization.
pub enum OutlookEventRefresh {
    /// The current event or series, normalized.
    Refreshed {
        /// What the calendar stores.
        upsert: Box<CalendarEventUpsert>,
        /// Occurrences of the series Macro could not read and left out, as
        /// Google sync never shows what it cannot normalize. The rest of the
        /// series is still imported.
        skipped: Vec<SkippedOccurrence>,
    },
    /// Microsoft no longer has the event on this calendar.
    Gone,
    /// Microsoft has the event, but Macro cannot represent it. The sync skips
    /// it and retires any copy stored before, so the calendar never shows an
    /// event Macro could not read, as Google sync never shows one.
    Unreadable {
        /// Path of the Graph property Macro rejected, such as
        /// `recurrence.range.endDate` or `instances.start.dateTime`.
        field: String,
    },
}

/// An occurrence left out of an imported series.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedOccurrence {
    /// Graph's id of the occurrence.
    pub provider_id: String,
    /// Path of the Graph property Macro rejected, such as
    /// `instances.originalStart.missing`.
    pub field: String,
}

/// Provider reads with normalized results and no persistence policy.
pub trait OutlookCalendarReader: Send + Sync + 'static {
    /// Revision of the normalization. Raise it with a change that lets Macro
    /// read events an older revision skipped: each delta calendar then reads
    /// those events again once, on its next round.
    const READER_REVISION: i16;
    /// Discover all visible calendars, following every page.
    fn calendars(
        &self,
        token: &str,
        binding: CalendarGrantBinding,
    ) -> impl Future<Output = Result<OutlookDiscovery, CalendarProviderError>> + Send;
    /// Fetch one provider page without advancing any checkpoint. A `delta`
    /// round reads the primary calendar's changes; any other lists every event
    /// in the target's range.
    fn calendar_page(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        delta: bool,
        cursor: Option<&str>,
    ) -> impl Future<Output = Result<OutlookCalendarPage, CalendarProviderError>> + Send;
    /// Refresh one event or complete recurring series, bounded to the target window.
    fn refresh_calendar_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> impl Future<Output = Result<OutlookEventRefresh, CalendarProviderError>> + Send;
}

/// Calendar-owned persistence and exact-generation leases.
pub trait OutlookCalendarRepository: CalendarRepository {
    /// Reconcile grant capability and claim one due job atomically for a
    /// worker reading at `reader_revision`.
    fn claim_outlook_calendar(
        &self,
        lease_id: Uuid,
        range: OccurrenceRange,
        reader_revision: i16,
    ) -> impl Future<Output = Result<Option<OutlookCalendarLease>, Report>> + Send;
    /// Extend a live lease, failing after disconnect or custody change.
    fn renew_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Commit complete calendar discovery, retiring removed calendars, and
    /// report what it changed.
    fn commit_outlook_calendars(
        &self,
        lease: &OutlookCalendarLease,
        calendars: Vec<OutlookCalendar>,
    ) -> impl Future<Output = Result<OutlookCalendarsChange, Report>> + Send;
    /// Whole-snapshot fixture helper; production uses staged checkpoints.
    #[cfg(test)]
    fn commit_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        observed: Option<Vec<String>>,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Advance one exact leased step, preserving all pending work across
    /// crashes, and report what the step completed.
    fn checkpoint_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        progress: OutlookCalendarProgress,
    ) -> impl Future<Output = Result<OutlookCheckpoint, Report>> + Send;
    /// Persist a sanitized failure and release a matching lease for retry,
    /// reporting whether the calendar's sync error badge showed or changed.
    fn fail_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        kind: CalendarProviderErrorKind,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
    /// Release a matching lease to retry after `delay`, recording no failure:
    /// Macro's own request admission refused a call, so nothing reached
    /// Microsoft.
    fn defer_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        delay: std::time::Duration,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// How much claimable work is waiting.
    fn outlook_queue_depth(&self)
    -> impl Future<Output = Result<OutlookQueueDepth, Report>> + Send;
}

/// The claimable work waiting for an Outlook sync loop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutlookQueueDepth {
    /// Due, unleased work rows of accounts a claim may take.
    pub due_items: i64,
    /// How long the longest-waiting of them has been due, when any is.
    pub oldest_due_seconds: Option<i64>,
}

/// The wait before retrying a deferred claim when the admission names none.
const DEFERRAL: std::time::Duration = std::time::Duration::from_secs(5);
/// The longest a deferred claim waits, the same cap as a failure's backoff.
const MAX_DEFERRAL: std::time::Duration = std::time::Duration::from_secs(900);

/// Domain coordinator for discovery, backfill, delta and bounded polling.
pub struct OutlookCalendarSync<R, P, T, N> {
    repository: R,
    provider: P,
    tokens: T,
    notifier: N,
    writes_enabled: bool,
}

impl<
    R: OutlookCalendarRepository + AutomaticDeclineRepository,
    P: OutlookCalendarReader + AutomaticDeclineProvider,
    T: CalendarAccessTokenProvider,
    N: CalendarRefreshNotifier,
> OutlookCalendarSync<R, P, T, N>
{
    /// Compose the use case with provider and persistence ports.
    pub fn new(repository: R, provider: P, tokens: T, notifier: N) -> Self {
        Self {
            repository,
            provider,
            tokens,
            notifier,
            writes_enabled: false,
        }
    }
    /// Permit new automatic invitation responses separately from sync reads.
    pub fn with_writes_enabled(mut self, enabled: bool) -> Self {
        self.writes_enabled = enabled;
        self
    }
    /// Log how much claimable work is waiting, so a monitor can read queue
    /// depth and the longest wait directly. Spans are sampled; the log is not.
    #[tracing::instrument(
        name = "calendar.outlook_queue_depth",
        skip_all,
        fields(due_items = tracing::field::Empty, oldest_due_seconds = tracing::field::Empty),
        err
    )]
    pub async fn report_queue_depth(&self) -> Result<OutlookQueueDepth, Report> {
        let depth = self.repository.outlook_queue_depth().await?;
        let span = tracing::Span::current();
        span.record("due_items", depth.due_items);
        if let Some(oldest) = depth.oldest_due_seconds {
            span.record("oldest_due_seconds", oldest);
        }
        tracing::info!(
            due_items = depth.due_items,
            oldest_due_seconds = depth.oldest_due_seconds,
            "Outlook calendar sync queue depth"
        );
        Ok(depth)
    }
    /// Claim and perform one bounded job. Heartbeats also revalidate custody.
    pub async fn run_once(&self) -> Result<bool, Report> {
        let Some(lease) = self
            .repository
            .claim_outlook_calendar(
                Uuid::now_v7(),
                OccurrenceRange::maintenance_horizon(chrono::Utc::now()),
                P::READER_REVISION,
            )
            .await?
        else {
            return Ok(false);
        };
        let change = match self.run_claim(&lease).await {
            Err(error) if error.kind() == CalendarProviderErrorKind::Deferred => {
                let delay = error
                    .retry_after()
                    .unwrap_or(DEFERRAL)
                    .clamp(std::time::Duration::from_secs(1), MAX_DEFERRAL);
                self.repository
                    .defer_outlook_calendar(&lease, delay)
                    .await?;
                return Ok(true);
            }
            Err(error) => {
                // The owner's viewers see a failure only once it shows or
                // rewords the badge, so only those failures refresh them; a
                // retry of the same failure stays quiet, so an outage does
                // not refresh every client on every attempt.
                if self
                    .repository
                    .fail_outlook_calendar(&lease, error.kind())
                    .await?
                {
                    self.refresh_viewers(&lease, OutlookCalendarsChange::SYNC_ERROR_BADGE)
                        .await;
                }
                return Err(rootcause::report!(error).into());
            }
            Ok(change) => change,
        };
        // As on Google, a discovery that found the calendars as stored sends
        // nothing. Each event it retired announces itself through the relay.
        if let Some(change) = change {
            self.refresh_viewers(&lease, change).await;
        }
        Ok(true)
    }
    async fn refresh_viewers(&self, lease: &OutlookCalendarLease, change: OutlookCalendarsChange) {
        if change.changed {
            self.notifier
                .calendar_changed(
                    &lease.owner_id,
                    lease.binding.link_id,
                    change.team_ooo_changed,
                )
                .await;
        }
    }
    #[tracing::instrument(
        name = "calendar.outlook_sync",
        skip_all,
        fields(
            work_id = %lease.id,
            account_id = %lease.account_id,
            calendar_id = lease.target.as_ref().map(|target| tracing::field::display(target.calendar_id)),
            step = tracing::field::Empty,
            near_window = tracing::field::Empty,
            untimed_members = tracing::field::Empty,
            milestone = tracing::field::Empty,
            provider_event_id = tracing::field::Empty,
            outcome = tracing::field::Empty,
            rejected_field = tracing::field::Empty,
            skipped_occurrences = tracing::field::Empty,
            unmapped_time_zone = tracing::field::Empty,
            calendars_changed = tracing::field::Empty,
            sync_error_cleared = tracing::field::Empty,
            error_kind = tracing::field::Empty,
        ),
        err(level = tracing::Level::DEBUG)
    )]
    async fn run_claim(
        &self,
        lease: &OutlookCalendarLease,
    ) -> Result<Option<OutlookCalendarsChange>, CalendarProviderError> {
        let span = tracing::Span::current();
        let token = self
            .tokens
            .fetch_access_token(&lease.token_identity)
            .await
            .map_err(|error| {
                CalendarProviderError::new(
                    match error {
                        CalendarTokenError::ReauthRequired(_) => {
                            CalendarProviderErrorKind::ReauthRequired
                        }
                        CalendarTokenError::Transient(_) => CalendarProviderErrorKind::Transient,
                    },
                    "Microsoft calendar credential acquisition failed",
                )
            })
            .inspect_err(|error| record_failure(&span, error))?;
        let work = async {
            if let Some(target) = &lease.target {
                let progress = if let Some(id) = lease.pending_ids.first() {
                    span.record("step", "event");
                    span.record("provider_event_id", id.as_str());
                    let id = id.clone();
                    match self
                        .provider
                        .refresh_calendar_event(&token, target, &id)
                        .await?
                    {
                        OutlookEventRefresh::Refreshed {
                            mut upsert,
                            skipped,
                        } => {
                            span.record("outcome", "refreshed");
                            // A series without an occurrence Macro could not
                            // read is not the calendar's whole snapshot of
                            // it. Stored under no role, it stays out of team
                            // reads, which would take the gap for free time,
                            // as Google fails such a series instead.
                            if !skipped.is_empty() {
                                upsert.source.details_mut().observed_access_role = None;
                            }
                            if let Some(first) = skipped.first() {
                                span.record("rejected_field", first.field.as_str());
                                span.record("skipped_occurrences", skipped.len() as i64);
                            }
                            for occurrence in &skipped {
                                tracing::warn!(
                                    calendar_id = %target.calendar_id,
                                    provider_event_id = %id,
                                    occurrence_id = %occurrence.provider_id,
                                    rejected_field = %occurrence.field,
                                    "skipping an Outlook occurrence Macro cannot read"
                                );
                            }
                            self.repository
                                .upsert_event(CalendarEventWrite::OutlookSync {
                                    lease: Box::new(lease.clone()),
                                    upsert: *upsert,
                                })
                                .await
                                .map_err(storage_error)?;
                            OutlookCalendarProgress::Event { id, exists: true }
                        }
                        OutlookEventRefresh::Gone => {
                            span.record("outcome", "gone");
                            OutlookCalendarProgress::Event { id, exists: false }
                        }
                        OutlookEventRefresh::Unreadable { field } => {
                            span.record("outcome", "unreadable");
                            span.record("rejected_field", field.as_str());
                            tracing::warn!(
                                calendar_id = %target.calendar_id,
                                provider_event_id = %id,
                                rejected_field = %field,
                                "skipping an Outlook event Macro cannot read"
                            );
                            OutlookCalendarProgress::Unreadable { id }
                        }
                    }
                } else if lease.page_loaded {
                    span.record("step", "finish");
                    automatic_decline::run(
                        &self.repository,
                        &self.provider,
                        lease,
                        &token,
                        self.writes_enabled,
                    )
                    .await?;
                    OutlookCalendarProgress::Finish
                } else {
                    span.record("step", "page");
                    span.record("near_window", lease.near_window);
                    let near;
                    let (listed, delta) = if lease.near_window {
                        near = ProviderCalendarTarget {
                            range: OccurrenceRange::near_window(chrono::Utc::now()),
                            ..target.clone()
                        };
                        (&near, false)
                    } else {
                        (target, lease.is_primary)
                    };
                    match self
                        .provider
                        .calendar_page(&token, listed, delta, lease.page_cursor.as_deref())
                        .await
                    {
                        Ok(page) => {
                            if lease.near_window {
                                // Members without a time Macro can read are
                                // read last, so a rising count means the
                                // near window lost its order.
                                span.record(
                                    "untimed_members",
                                    page.members.iter().filter(|m| m.occurs.is_none()).count()
                                        as i64,
                                );
                            }
                            OutlookCalendarProgress::Page(page)
                        }
                        Err(error)
                            if error.kind() == CalendarProviderErrorKind::SyncTokenExpired =>
                        {
                            OutlookCalendarProgress::Reset
                        }
                        Err(error) => return Err(error),
                    }
                };
                let checkpoint = self
                    .repository
                    .checkpoint_outlook_calendar(lease, progress)
                    .await
                    .map_err(storage_error)?;
                record_milestone(&span, lease, target, checkpoint);
                let cleared = matches!(
                    checkpoint,
                    OutlookCheckpoint::RoundFinished {
                        cleared_sync_error: true,
                        ..
                    }
                );
                if cleared {
                    span.record("sync_error_cleared", true);
                }
                Ok(cleared.then_some(OutlookCalendarsChange::SYNC_ERROR_BADGE))
            } else {
                span.record("step", "discover");
                let discovery = self.provider.calendars(&token, lease.binding).await?;
                if let Some(zone) = &discovery.unmapped_time_zone {
                    span.record("unmapped_time_zone", zone.as_str());
                    tracing::warn!(
                        account_id = %lease.account_id,
                        unmapped_time_zone = %zone,
                        "ignoring an Outlook mailbox time zone Macro cannot map"
                    );
                }
                let change = self
                    .repository
                    .commit_outlook_calendars(lease, discovery.calendars)
                    .await
                    .map_err(storage_error)?;
                span.record("calendars_changed", change.changed);
                Ok(Some(change))
            }
        };
        let heartbeat = async {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                self.repository
                    .renew_outlook_calendar(lease)
                    .await
                    .map_err(storage_error)?;
            }
            #[allow(unreachable_code)]
            Ok(None)
        };
        futures::pin_mut!(work, heartbeat);
        match futures::future::select(work, heartbeat).await {
            futures::future::Either::Left((result, _))
            | futures::future::Either::Right((result, _)) => result,
        }
        .inspect_err(|error| record_failure(&span, error))
    }
}

/// Marks the end of a first import's near window and of a calendar's first
/// sync, with the time since the calendar's work was created (its first
/// discovery), so time to the current month can be read per calendar.
fn record_milestone(
    span: &tracing::Span,
    lease: &OutlookCalendarLease,
    target: &ProviderCalendarTarget,
    checkpoint: OutlookCheckpoint,
) {
    let milestone = match checkpoint {
        OutlookCheckpoint::NearWindowImported => "near_window_imported",
        OutlookCheckpoint::RoundFinished {
            first_sync: true, ..
        } => "first_sync_finished",
        OutlookCheckpoint::Step
        | OutlookCheckpoint::RoundFinished {
            first_sync: false, ..
        } => {
            return;
        }
    };
    span.record("milestone", milestone);
    let since_discovery_s = lease.id.get_timestamp().map(|created| {
        chrono::Utc::now().timestamp() - i64::try_from(created.to_unix().0).unwrap_or(i64::MAX)
    });
    tracing::info!(
        account_id = %lease.account_id,
        calendar_id = %target.calendar_id,
        is_primary = lease.is_primary,
        milestone,
        since_discovery_s,
        "an Outlook calendar's first import reached a milestone"
    );
}

fn record_failure(span: &tracing::Span, error: &CalendarProviderError) {
    span.record(
        "outcome",
        if error.kind() == CalendarProviderErrorKind::Deferred {
            "deferred"
        } else {
            "failed"
        },
    );
    span.record("error_kind", tracing::field::debug(error.kind()));
}

fn storage_error(_error: Report) -> CalendarProviderError {
    CalendarProviderError::new(
        CalendarProviderErrorKind::Transient,
        "Microsoft calendar persistence or lease is unavailable",
    )
}

/// Revision-fenced notification to publish after a committed calendar change.
pub struct CalendarProjectionLease {
    /// Entity being refreshed or retired.
    pub event_id: Uuid,
    /// Compare-and-swap revision.
    pub revision: i64,
    /// Publication lease.
    pub lease_id: Uuid,
    /// Owning connected inbox, used for viewer refresh.
    pub link_id: Uuid,
    /// Whether teammates' out-of-office rows may have changed: the event was
    /// or is out of office in a change this revision carries.
    pub team_ooo_changed: bool,
    /// Committed change metadata.
    pub event: super::events::CalendarTopicEvent,
}

/// The most revisions one relay round publishes. A round that claims fewer
/// has taken everything due, so the relay waits for its next poll, and the
/// changes that arrive meanwhile share one refresh per inbox.
pub const PROJECTION_BATCH: u16 = 100;

/// Transactional projection publication journal.
pub trait CalendarProjectionOutbox: Send + Sync + 'static {
    /// Claim up to `limit` pending changes under one lease, earliest due first.
    fn claim_projections(
        &self,
        lease_id: Uuid,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<CalendarProjectionLease>, Report>> + Send;
    /// Acknowledge exactly the published revision, preserving concurrent updates.
    fn complete_projection(
        &self,
        lease: &CalendarProjectionLease,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Reliable publication of committed calendar changes to search and other consumers.
pub struct CalendarProjectionRelay<R, B, N> {
    repository: R,
    broker: B,
    notifier: N,
}
impl<
    R: CalendarProjectionOutbox,
    B: macro_event_broker::MacroEventBroker,
    N: CalendarRefreshNotifier,
> CalendarProjectionRelay<R, B, N>
{
    /// Compose the journal, broker and viewer notifier.
    pub fn new(repository: R, broker: B, notifier: N) -> Self {
        Self {
            repository,
            broker,
            notifier,
        }
    }
    /// Publish one batch of committed revisions, then refresh each inbox the
    /// published ones changed once, however many of its events changed. A
    /// revision that fails to publish keeps its lease and is claimed again
    /// once the lease expires, as a crash leaves it; the rest still complete.
    /// Returns whether the batch was full, so more may be due.
    pub async fn run_once(&self) -> Result<bool, Report> {
        let leases = self
            .repository
            .claim_projections(Uuid::now_v7(), PROJECTION_BATCH)
            .await?;
        // An idle poll claims nothing and gets no span, so the relay's root
        // spans are only the rounds that published something.
        if leases.is_empty() {
            return Ok(false);
        }
        self.publish_batch(leases).await
    }
    #[tracing::instrument(
        name = "calendar.projection_relay",
        skip_all,
        fields(
            claimed = leases.len() as i64,
            failed = tracing::field::Empty,
            refreshes = tracing::field::Empty,
        ),
        err(level = tracing::Level::DEBUG)
    )]
    async fn publish_batch(&self, leases: Vec<CalendarProjectionLease>) -> Result<bool, Report> {
        let span = tracing::Span::current();
        let claimed = leases.len();
        let outcomes =
            futures::future::join_all(leases.iter().map(|lease| self.publish(lease))).await;
        if let Some(error) = outcomes.iter().find_map(|outcome| outcome.as_ref().err()) {
            tracing::warn!(
                error = ?error,
                failed = outcomes.iter().filter(|outcome| outcome.is_err()).count(),
                "Calendar projection publication will retry"
            );
        }
        let published: Vec<_> = leases
            .into_iter()
            .zip(outcomes)
            .filter_map(|(lease, outcome)| outcome.is_ok().then_some(lease))
            .collect();
        span.record("failed", (claimed - published.len()) as i64);

        // An inbox's refresh may change teammates' out-of-office rows when
        // any of its published revisions may.
        let mut inboxes = std::collections::BTreeMap::<_, bool>::new();
        for lease in &published {
            *inboxes
                .entry((lease.event.metadata().owner_id.as_str(), lease.link_id))
                .or_default() |= lease.team_ooo_changed;
        }
        span.record("refreshes", inboxes.len() as i64);
        for ((owner_id, link_id), team_ooo_changed) in inboxes {
            self.notifier
                .calendar_changed(owner_id, link_id, team_ooo_changed)
                .await;
        }
        // One revision per transaction: the outbox trigger locks these rows
        // from writes that change several events, so a batch that locked
        // many at once could deadlock with them. One that fails stays leased
        // for its retry; the others are still acknowledged, so they are not
        // published again.
        let mut acknowledgement_error = None;
        for lease in &published {
            if let Err(error) = self.repository.complete_projection(lease).await {
                acknowledgement_error.get_or_insert(error);
            }
        }
        match acknowledgement_error {
            Some(error) => Err(error),
            None => Ok(claimed == usize::from(PROJECTION_BATCH)),
        }
    }
    #[tracing::instrument(
        name = "calendar.projection_publish",
        skip_all,
        fields(
            event_id = %lease.event_id,
            revision = lease.revision,
            link_id = %lease.link_id,
            team_ooo_changed = lease.team_ooo_changed,
        ),
        err(level = tracing::Level::DEBUG)
    )]
    async fn publish(&self, lease: &CalendarProjectionLease) -> Result<(), Report> {
        let event = super::events::CalendarMacroEvent::for_change(lease.event.clone());
        self.broker
            .send_event(&event)
            .map_err(|e| rootcause::report!(e))?
            .await
            .map_err(|e| rootcause::report!(e))?
            .map_err(|e| rootcause::report!(e))?;
        Ok(())
    }
}
