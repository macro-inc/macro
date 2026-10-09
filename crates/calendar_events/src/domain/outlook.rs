//! Durable Outlook calendar synchronization, independent of Google's grant jobs.

/// Explicit, durable out-of-office invitation response policy.
pub mod automatic_decline;
use super::{models::*, ports::*};
use automatic_decline::{AutomaticDeclineProvider, AutomaticDeclineRepository};
use rootcause::Report;
use uuid::Uuid;

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
}

/// Complete discovery result for a provider calendar.
pub struct OutlookCalendar {
    /// Shared calendar metadata.
    pub calendar: ProviderCalendar,
    /// Meeting providers actually allowed by this calendar.
    pub online_meeting_providers: Vec<String>,
}

/// One page of event identities. Its cursor is staged with its child work.
pub struct OutlookCalendarPage {
    /// (Provider occurrence/single ID, normalized master/single ID).
    pub members: Vec<(String, String)>,
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
    /// Finish a page, or atomically prune and commit the terminal cursor.
    Finish,
    /// Restart an expired or unresolvable delta with a new full snapshot.
    Reset,
}

/// Provider reads with normalized results and no persistence policy.
pub trait OutlookCalendarReader: Send + Sync + 'static {
    /// Discover all visible calendars, following every page.
    fn calendars(
        &self,
        token: &str,
        binding: CalendarGrantBinding,
    ) -> impl Future<Output = Result<Vec<OutlookCalendar>, CalendarProviderError>> + Send;
    /// Fetch one provider page without advancing any checkpoint.
    fn calendar_page(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        primary: bool,
        cursor: Option<&str>,
    ) -> impl Future<Output = Result<OutlookCalendarPage, CalendarProviderError>> + Send;
    /// Refresh one event or complete recurring series, bounded to the target window.
    fn refresh_calendar_event(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
    ) -> impl Future<Output = Result<Option<CalendarEventUpsert>, CalendarProviderError>> + Send;
}

/// Calendar-owned persistence and exact-generation leases.
pub trait OutlookCalendarRepository: CalendarRepository {
    /// Reconcile grant capability and claim one due job atomically.
    fn claim_outlook_calendar(
        &self,
        lease_id: Uuid,
        range: OccurrenceRange,
    ) -> impl Future<Output = Result<Option<OutlookCalendarLease>, Report>> + Send;
    /// Extend a live lease, failing after disconnect or custody change.
    fn renew_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Commit complete calendar discovery, retiring removed calendars.
    fn commit_outlook_calendars(
        &self,
        lease: &OutlookCalendarLease,
        calendars: Vec<OutlookCalendar>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Whole-snapshot fixture helper; production uses staged checkpoints.
    #[cfg(test)]
    fn commit_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        observed: Option<Vec<String>>,
        cursor: Option<String>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Advance one exact leased step, preserving all pending work across crashes.
    fn checkpoint_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        progress: OutlookCalendarProgress,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Persist a sanitized failure and release a matching lease for retry.
    fn fail_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        kind: CalendarProviderErrorKind,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

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
    /// Claim and perform one bounded job. Heartbeats also revalidate custody.
    pub async fn run_once(&self) -> Result<bool, Report> {
        let Some(lease) = self
            .repository
            .claim_outlook_calendar(
                Uuid::now_v7(),
                OccurrenceRange::maintenance_horizon(chrono::Utc::now()),
            )
            .await?
        else {
            return Ok(false);
        };
        let result = self.run_claim(&lease).await;
        if let Err(error) = &result {
            self.repository
                .fail_outlook_calendar(&lease, error.kind())
                .await?;
        }
        result.map_err(|error| rootcause::report!(error))?;
        if lease.target.is_none() {
            self.notifier
                .calendar_changed(&lease.owner_id, lease.binding.link_id)
                .await;
        }
        Ok(true)
    }
    async fn run_claim(&self, lease: &OutlookCalendarLease) -> Result<(), CalendarProviderError> {
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
            })?;
        let work = async {
            if let Some(target) = &lease.target {
                let progress = if let Some(id) = lease.pending_ids.first() {
                    let upsert = self
                        .provider
                        .refresh_calendar_event(&token, target, id)
                        .await?;
                    let exists = upsert.is_some();
                    if let Some(upsert) = upsert {
                        self.repository
                            .upsert_event(CalendarEventWrite::OutlookSync {
                                lease: Box::new(lease.clone()),
                                upsert,
                            })
                            .await
                            .map_err(storage_error)?;
                    }
                    OutlookCalendarProgress::Event {
                        id: id.clone(),
                        exists,
                    }
                } else if lease.page_loaded {
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
                    match self
                        .provider
                        .calendar_page(
                            &token,
                            target,
                            lease.is_primary,
                            lease.page_cursor.as_deref(),
                        )
                        .await
                    {
                        Ok(page) => OutlookCalendarProgress::Page(page),
                        Err(error)
                            if error.kind() == CalendarProviderErrorKind::SyncTokenExpired =>
                        {
                            OutlookCalendarProgress::Reset
                        }
                        Err(error) => return Err(error),
                    }
                };
                self.repository
                    .checkpoint_outlook_calendar(lease, progress)
                    .await
                    .map_err(storage_error)?;
            } else {
                let calendars = self.provider.calendars(&token, lease.binding).await?;
                self.repository
                    .commit_outlook_calendars(lease, calendars)
                    .await
                    .map_err(storage_error)?;
            }
            Ok(())
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
            Ok(())
        };
        futures::pin_mut!(work, heartbeat);
        match futures::future::select(work, heartbeat).await {
            futures::future::Either::Left((result, _))
            | futures::future::Either::Right((result, _)) => result,
        }
    }
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
    /// Committed change metadata.
    pub event: super::events::CalendarTopicEvent,
}

/// Transactional projection publication journal.
pub trait CalendarProjectionOutbox: Send + Sync + 'static {
    /// Claim one pending change.
    fn claim_projection(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<CalendarProjectionLease>, Report>> + Send;
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
    /// Publish one committed revision; a crash or failure retains it for replay.
    pub async fn run_once(&self) -> Result<bool, Report> {
        let Some(lease) = self.repository.claim_projection(Uuid::now_v7()).await? else {
            return Ok(false);
        };
        let event = super::events::CalendarMacroEvent::for_change(lease.event.clone());
        self.broker
            .send_event(&event)
            .map_err(|e| rootcause::report!(e))?
            .await
            .map_err(|e| rootcause::report!(e))?
            .map_err(|e| rootcause::report!(e))?;
        self.notifier
            .calendar_changed(&lease.event.metadata().owner_id, lease.link_id)
            .await;
        self.repository.complete_projection(&lease).await?;
        Ok(true)
    }
}
