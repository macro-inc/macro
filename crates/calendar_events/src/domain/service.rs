//! Calendar business policy.

use chrono::Utc;
use futures::future::{Either, select};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::events::{CalendarEventMetadata, CalendarMacroEvent, CalendarTopicEvent};
use macro_event_broker::MacroEventBroker;

use super::{
    models::{
        ActorInboxes, AppliedGoogleGrant, CalendarBackfillClaim,
        CalendarBackfillFailureDisposition, CalendarBackfillFailureOutcome, CalendarBackfillJobKey,
        CalendarEventUpsert, CalendarGrantIntent, CalendarOccurrenceCursor,
        GoogleBackfillRunReport, GoogleCalendarSyncSnapshot, GoogleScopeSet, OccurrenceRange,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventChange, CalendarEventWrite,
        CalendarEventWriteOutcome, CalendarOccurrenceService, CalendarRepository,
        GoogleCalendarProvider, GoogleCalendarSyncRepository, GoogleEventSyncContext,
        GoogleProviderError, GoogleProviderErrorKind, RetiredCalendarEvent,
    },
};

/// Domain validation failures.
#[derive(Debug, thiserror::Error)]
pub enum CalendarValidationError {
    /// Event identity was missing.
    #[error("calendar event requires a non-empty owner and iCalendar UID")]
    MissingIdentity,
    /// Event end was not after its start.
    #[error("calendar event end must be after its start")]
    InvalidTime,
    /// A query range was invalid or too large.
    #[error(
        "calendar occurrence range must be positive, no larger than 370 days, and inside the materialized one-year-history/two-year-future window"
    )]
    InvalidRange,
    /// A page size was outside the supported bound.
    #[error("calendar repository query limit must be between 1 and 2001")]
    InvalidLimit,
    /// A mention preview batch exceeded the supported size.
    #[error("calendar mention previews accept at most {MENTION_PREVIEWS_MAX} events per request")]
    TooManyMentions,
}

/// The most mentioned events one preview request resolves.
pub const MENTION_PREVIEWS_MAX: usize = 100;

/// Calendar use cases with provider and persistence details behind ports.
pub struct CalendarService<R> {
    repository: R,
}

impl<R> CalendarService<R>
where
    R: CalendarRepository,
{
    /// Construct the service.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Apply an OAuth grant using actual scopes returned by Google.
    ///
    /// The repository owns the transaction that increments the grant version
    /// and inserts the two idempotent backfill jobs. `intent` states whether
    /// the consent flow behind this grant explicitly asked for calendar
    /// access, which is what clears a standing calendar opt-out.
    #[tracing::instrument(skip(self, scopes), err)]
    pub async fn apply_google_grant(
        &self,
        email_link_id: Uuid,
        scopes: GoogleScopeSet,
        intent: CalendarGrantIntent,
    ) -> Result<AppliedGoogleGrant, Report> {
        self.repository
            .apply_google_grant(email_link_id, scopes, intent)
            .await
    }

    /// Query a bounded occurrence viewport.
    #[tracing::instrument(skip(self, requester_id, range), err)]
    pub async fn list_occurrences(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> Result<
        Vec<(
            super::models::CalendarEvent,
            super::models::CalendarOccurrence,
        )>,
        Report,
    > {
        validate_query(&range, limit)?;
        let mut rows = self
            .repository
            .list_occurrences(requester_id, range, cursor, limit)
            .await?;
        if let Some(viewer) =
            ActorInboxes::from_owned(self.repository.owned_inbox_emails(requester_id).await?)
        {
            for (event, _) in &mut rows {
                viewer.mark_attendees(&mut event.attendees);
            }
        }
        Ok(rows)
    }

    /// Return the aggregate ingestion state of the requester's visible accounts.
    #[tracing::instrument(skip(self, requester_id), err)]
    pub async fn sync_status(
        &self,
        requester_id: &str,
    ) -> Result<super::models::CalendarSyncStatus, Report> {
        self.repository.sync_status(requester_id).await
    }

    /// Resolve mentioned events to the requester's own projections.
    #[tracing::instrument(skip(self, requester_id, items), err)]
    pub async fn mention_previews(
        &self,
        requester_id: &str,
        items: Vec<super::models::CalendarMentionRequestItem>,
    ) -> Result<Vec<super::models::CalendarMentionPreview>, Report> {
        if items.len() > MENTION_PREVIEWS_MAX {
            return Err(rootcause::report!(CalendarValidationError::TooManyMentions).into());
        }
        if items.is_empty() {
            return Ok(Vec::new());
        }
        self.repository
            .mention_previews(requester_id, items, Utc::now())
            .await
    }

    /// Re-arm the watched inbox's sync job for a push notification whose
    /// channel token the adapter already verified. Returns whether the
    /// notification matched an active channel.
    #[tracing::instrument(skip(self, channel_id, resource_id), err)]
    pub async fn handle_watch_notification(
        &self,
        channel_id: &str,
        resource_id: &str,
    ) -> Result<bool, Report> {
        let Some(email_link_id) = self
            .repository
            .find_watch_target(channel_id, resource_id)
            .await?
        else {
            return Ok(false);
        };
        self.repository
            .schedule_google_sync_for_link(email_link_id)
            .await?;
        Ok(true)
    }
}

impl<R> CalendarOccurrenceService for CalendarService<R>
where
    R: CalendarRepository,
{
    fn list_occurrences(
        &self,
        requester_id: &str,
        range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> impl Future<
        Output = Result<
            Vec<(
                super::models::CalendarEvent,
                super::models::CalendarOccurrence,
            )>,
            Report,
        >,
    > + Send {
        CalendarService::list_occurrences(self, requester_id, range, cursor, limit)
    }

    fn sync_status(
        &self,
        requester_id: &str,
    ) -> impl Future<Output = Result<super::models::CalendarSyncStatus, Report>> + Send {
        CalendarService::sync_status(self, requester_id)
    }

    fn mention_previews(
        &self,
        requester_id: &str,
        items: Vec<super::models::CalendarMentionRequestItem>,
    ) -> impl Future<Output = Result<Vec<super::models::CalendarMentionPreview>, Report>> + Send
    {
        CalendarService::mention_previews(self, requester_id, items)
    }
}

/// Orchestrates a Google account backfill while keeping HTTP and SQL behind ports.
pub struct GoogleCalendarBackfillService<R, G, B> {
    repository: R,
    provider: G,
    macro_event_broker: B,
    watch: Option<super::models::GoogleWatchConfig>,
}

/// Renew a channel whenever less than this much lifetime remains, so every
/// poll cycle has several chances before expiry.
const WATCH_RENEWAL_THRESHOLD: chrono::Duration = chrono::Duration::hours(12);

/// Periodically makes completed provider jobs eligible for another incremental poll.
pub struct GoogleCalendarSyncScheduler<R> {
    repository: R,
}

impl<R> GoogleCalendarSyncScheduler<R>
where
    R: GoogleCalendarSyncRepository,
{
    /// Construct the scheduler from its persistence port.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Schedule current-grant accounts that have not been polled recently.
    #[tracing::instrument(skip(self), err)]
    pub async fn run_once(&self, now: chrono::DateTime<Utc>) -> Result<usize, Report> {
        self.repository
            .schedule_due_google_syncs(now - chrono::Duration::minutes(5))
            .await
    }
}

/// Applies terminal Google Calendar failures that happen before lease claim.
pub struct GoogleCalendarBackfillFailureService<L> {
    lifecycle: L,
}

impl<L> GoogleCalendarBackfillFailureService<L>
where
    L: CalendarBackfillRepository,
{
    /// Construct the failure application service from its persistence port.
    pub fn new(lifecycle: L) -> Self {
        Self { lifecycle }
    }

    /// Atomically terminate an unclaimed job and update its account and inbox health.
    #[tracing::instrument(skip(self, message), err)]
    pub async fn fail_unclaimed(
        &self,
        key: CalendarBackfillJobKey,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, Report> {
        if disposition == CalendarBackfillFailureDisposition::Retry {
            return Err(rootcause::report!(
                "unclaimed Google Calendar failures must be terminal"
            ));
        }
        self.lifecycle
            .fail_unclaimed_google_backfill(key, disposition, message)
            .await
    }
}

/// Queue-visible outcome of executing a fenced Google Calendar backfill.
#[derive(Debug, thiserror::Error)]
pub enum GoogleCalendarBackfillRunError {
    /// Another delivery owns the durable lease.
    #[error("Google Calendar backfill is already leased")]
    Busy,
    /// The durable job does not exist for the supplied inbox.
    #[error("Google Calendar backfill job was not found")]
    NotFound,
    /// The job previously ended with a permanent failure.
    #[error("Google Calendar backfill is already failed")]
    AlreadyFailed,
    /// Lease ownership was lost while provider work was running.
    #[error("Google Calendar backfill lease was lost")]
    LeaseLost,
    /// The provider grant must be refreshed by the user.
    #[error("Google Calendar grant requires reauthorization: {message}")]
    ReauthRequired {
        /// Provider failure detail.
        message: String,
        /// Whether this failure consumed the inbox's healthy-to-reauth edge.
        link_reauth_transitioned: bool,
    },
    /// Google rejected the request permanently.
    #[error("Google Calendar rejected the backfill request: {0}")]
    Permanent(String),
    /// The job can be retried without user action.
    #[error("Google Calendar backfill failed transiently: {0}")]
    Retryable(String),
}

/// Application service that owns Google backfill claim, lease, and terminal policy.
pub struct GoogleCalendarBackfillCoordinator<R, G, L, B> {
    repository: R,
    provider: G,
    lifecycle: L,
    macro_event_broker: B,
    watch: Option<super::models::GoogleWatchConfig>,
}

impl<R, G, L, B> GoogleCalendarBackfillCoordinator<R, G, L, B>
where
    R: CalendarRepository + Clone,
    G: GoogleCalendarProvider + Clone,
    L: CalendarBackfillRepository,
    B: MacroEventBroker + Clone,
{
    /// Construct a coordinator from domain ports; supplying a watch config
    /// makes every backfill maintain push notification channels.
    pub fn new(
        repository: R,
        provider: G,
        lifecycle: L,
        macro_event_broker: B,
        watch: Option<super::models::GoogleWatchConfig>,
    ) -> Self {
        Self {
            repository,
            provider,
            lifecycle,
            macro_event_broker,
            watch,
        }
    }

    /// Execute one idempotent queue delivery under a fenced renewable lease.
    ///
    /// `report` accumulates durable progress and remains meaningful on
    /// failure: per-calendar commits that landed before the error survive
    /// the retry, so callers should act on the report either way.
    #[tracing::instrument(skip(self, owner_id, access_token, range, report), fields(job_id = %key.job_id), err)]
    pub async fn run(
        &self,
        key: CalendarBackfillJobKey,
        owner_id: &str,
        access_token: &str,
        range: OccurrenceRange,
        report: &mut GoogleBackfillRunReport,
    ) -> Result<(), GoogleCalendarBackfillRunError> {
        let (lease_token, account_id) = match self
            .lifecycle
            .claim_google_backfill(key)
            .await
            .map_err(|error| GoogleCalendarBackfillRunError::Retryable(format!("{error:?}")))?
        {
            CalendarBackfillClaim::Claimed {
                lease_token,
                account_id,
            } => (lease_token, account_id),
            CalendarBackfillClaim::Complete => return Ok(()),
            CalendarBackfillClaim::Busy => return Err(GoogleCalendarBackfillRunError::Busy),
            CalendarBackfillClaim::Failed => {
                return Err(GoogleCalendarBackfillRunError::AlreadyFailed);
            }
            CalendarBackfillClaim::NotFound => {
                return Err(GoogleCalendarBackfillRunError::NotFound);
            }
        };

        if let Err(error) = self
            .lifecycle
            .mark_google_account_syncing(key, lease_token)
            .await
        {
            let message = format!("{error:?}");
            self.persist_failure(
                key,
                lease_token,
                CalendarBackfillFailureDisposition::Retry,
                &message,
            )
            .await?;
            return Err(GoogleCalendarBackfillRunError::Retryable(message));
        }

        let backfill = GoogleCalendarBackfillService::new(
            self.repository.clone(),
            self.provider.clone(),
            self.macro_event_broker.clone(),
            self.watch.clone(),
        );
        let work = backfill.backfill(
            key,
            lease_token,
            account_id,
            owner_id,
            access_token,
            range,
            report,
        );
        let lease = self
            .lifecycle
            .maintain_google_backfill_lease(key, lease_token);
        futures::pin_mut!(work);
        futures::pin_mut!(lease);
        let result = match select(work, lease).await {
            Either::Left((result, _lease)) => result,
            Either::Right((_lease_result, _work)) => {
                return Err(GoogleCalendarBackfillRunError::LeaseLost);
            }
        };

        match result {
            Ok(()) => {
                self.lifecycle
                    .complete_google_backfill(key, lease_token)
                    .await
                    .map_err(|_| GoogleCalendarBackfillRunError::LeaseLost)?;
                Ok(())
            }
            Err(error) => {
                let provider_error = error
                    .as_ref()
                    .downcast_current_context::<GoogleProviderError>();
                let disposition = match provider_error.map(GoogleProviderError::kind) {
                    Some(GoogleProviderErrorKind::ReauthRequired) => {
                        CalendarBackfillFailureDisposition::CalendarPermissionRequired
                    }
                    Some(GoogleProviderErrorKind::Permanent) => {
                        CalendarBackfillFailureDisposition::Permanent
                    }
                    Some(
                        GoogleProviderErrorKind::Transient
                        | GoogleProviderErrorKind::SyncTokenExpired,
                    )
                    | None => CalendarBackfillFailureDisposition::Retry,
                };
                let message = format!("{error:?}");
                let outcome = self
                    .persist_failure(key, lease_token, disposition, &message)
                    .await?;
                Err(match disposition {
                    CalendarBackfillFailureDisposition::ReauthRequired
                    | CalendarBackfillFailureDisposition::CalendarPermissionRequired => {
                        GoogleCalendarBackfillRunError::ReauthRequired {
                            message,
                            link_reauth_transitioned: outcome.link_reauth_transitioned,
                        }
                    }
                    CalendarBackfillFailureDisposition::Permanent => {
                        GoogleCalendarBackfillRunError::Permanent(message)
                    }
                    CalendarBackfillFailureDisposition::Retry => {
                        GoogleCalendarBackfillRunError::Retryable(message)
                    }
                })
            }
        }
    }

    async fn persist_failure(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        disposition: CalendarBackfillFailureDisposition,
        message: &str,
    ) -> Result<CalendarBackfillFailureOutcome, GoogleCalendarBackfillRunError> {
        self.lifecycle
            .fail_google_backfill(key, lease_token, disposition, message)
            .await
            .map_err(|_| GoogleCalendarBackfillRunError::LeaseLost)
    }
}

impl<R, G, B> GoogleCalendarBackfillService<R, G, B>
where
    R: CalendarRepository,
    G: GoogleCalendarProvider,
    B: MacroEventBroker,
{
    /// Construct the provider backfill service.
    pub fn new(
        repository: R,
        provider: G,
        macro_event_broker: B,
        watch: Option<super::models::GoogleWatchConfig>,
    ) -> Self {
        Self {
            repository,
            provider,
            macro_event_broker,
            watch,
        }
    }

    /// Publish one calendar topic event. Sync progress is already committed by
    /// the time this runs, so a publish failure is logged and dropped rather
    /// than failing the run — the search backfill re-enumerates present rows.
    fn publish_calendar_event(&self, event: CalendarTopicEvent) {
        let _ = self
            .macro_event_broker
            .send_event(&CalendarMacroEvent::for_change(event))
            .inspect_err(|error| {
                tracing::error!(error=?error, "failed to publish calendar event");
            });
    }

    /// Announce what a write did to the canonical row. A write that changed
    /// nothing publishes nothing, so a full snapshot re-observing thousands of
    /// unchanged events stays off the topic.
    fn publish_write_outcome(&self, outcome: &CalendarEventWriteOutcome) {
        let metadata = CalendarEventMetadata {
            event_id: outcome.event_id,
            owner_id: outcome.owner_id.clone(),
        };
        match outcome.change {
            CalendarEventChange::Created => {
                self.publish_calendar_event(CalendarTopicEvent::Created(metadata));
            }
            CalendarEventChange::Updated => {
                self.publish_calendar_event(CalendarTopicEvent::Updated(metadata));
            }
            CalendarEventChange::Unchanged => {}
        }
    }

    /// Announce every event a source retirement touched. Retiring a source
    /// does not necessarily remove the event — the row survives, rewritten
    /// from its next-best remaining source — so each event reports its own
    /// fate. Without this a provider-side deletion would leave a permanently
    /// stale search document: the row is gone, so the backfill can never
    /// re-enumerate it.
    fn publish_retirements(&self, retired: Vec<RetiredCalendarEvent>) {
        for event in retired {
            let metadata = CalendarEventMetadata {
                event_id: event.event_id,
                owner_id: event.owner_id,
            };
            self.publish_calendar_event(if event.deleted {
                CalendarTopicEvent::Deleted(metadata)
            } else {
                CalendarTopicEvent::Updated(metadata)
            });
        }
    }

    /// Fetch and reconcile calendars and events for a connected inbox.
    ///
    /// Progress accumulates into `report` as each calendar commits, so a
    /// caller observes durable partial progress even when a later calendar
    /// fails the run: those commits survive the retry, whose quiet re-run
    /// would never report them again.
    #[allow(clippy::too_many_arguments)]
    #[tracing::instrument(skip(self, owner_id, access_token, range, report), err)]
    pub async fn backfill(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        owner_id: &str,
        access_token: &str,
        range: OccurrenceRange,
        report: &mut GoogleBackfillRunReport,
    ) -> Result<(), Report> {
        if !range.is_valid_for_backfill() {
            return Err(rootcause::report!(CalendarValidationError::InvalidRange).into());
        }
        let calendars = self
            .provider
            .list_calendars(access_token, key.email_link_id)
            .await
            .map_err(|error| -> Report { rootcause::report!(error).into() })?;
        let mut calendar_ids = Vec::with_capacity(calendars.len());

        for provider_calendar in calendars {
            let provider_calendar_id = provider_calendar.provider_calendar_id.clone();
            let watch_provider_calendar_id = provider_calendar.provider_calendar_id.clone();
            let is_read_only = !matches!(
                provider_calendar.access_role.as_deref(),
                Some("owner" | "writer")
            );
            let stored_calendar = self
                .repository
                .upsert_google_calendar(key, lease_token, account_id, provider_calendar)
                .await?;
            let calendar_id = stored_calendar.id;
            calendar_ids.push(calendar_id);
            if super::models::is_system_calendar(&provider_calendar_id)
                && stored_calendar.synced_at.is_some_and(|synced_at| {
                    synced_at > Utc::now() - super::models::SYSTEM_CALENDAR_SYNC_INTERVAL
                })
            {
                continue;
            }
            let plan = stored_calendar.sync_plan(&range);
            let batch = self
                .provider
                .sync_events(
                    access_token,
                    GoogleEventSyncContext {
                        target: super::models::GoogleCalendarTarget {
                            owner_id: owner_id.to_string(),
                            email_link_id: key.email_link_id,
                            account_id,
                            calendar_id,
                            provider_calendar_id,
                            is_read_only,
                            range: range.clone(),
                        },
                        sync_token: stored_calendar.sync_token,
                        plan,
                    },
                )
                .await
                .map_err(|error| -> Report { rootcause::report!(error).into() })?;
            let mut calendar_count = 0;
            for upsert in batch.upserts {
                if let Err(error) = validate_upsert(&upsert) {
                    tracing::warn!(
                        error=?error,
                        calendar_id=%calendar_id,
                        ical_uid=%upsert.event.ical_uid,
                        "skipping invalid normalized Google Calendar event"
                    );
                    continue;
                }
                let super::models::CalendarEventSource::Google(source) = &upsert.source;
                debug_assert_eq!(source.calendar_id, calendar_id);
                let outcome = self
                    .repository
                    .upsert_event(CalendarEventWrite::GoogleBackfill {
                        key,
                        lease_token,
                        upsert,
                    })
                    .await?;
                self.publish_write_outcome(&outcome);
                calendar_count += 1;
            }
            // The upserts above committed individually, so they count even
            // if this calendar's snapshot commit below fails.
            report.events_upserted += calendar_count;
            let cancellation_count = batch.cancelled_provider_event_ids.len();
            // Committing per calendar keeps earlier calendars' sync tokens
            // durable when a later calendar's poll fails, so the retry only
            // re-pulls what never committed.
            let retired = self
                .repository
                .commit_google_calendar_sync(
                    key,
                    lease_token,
                    account_id,
                    GoogleCalendarSyncSnapshot {
                        calendar_id,
                        next_sync_token: batch.next_sync_token,
                        observed_provider_event_ids: batch.observed_provider_event_ids,
                        materialized_range: batch.materialized_range,
                        cancelled_provider_event_ids: batch.cancelled_provider_event_ids,
                    },
                    calendar_count,
                )
                .await?;
            // A provider-side deletion reaches search only here: the row is
            // gone once the commit lands, so nothing downstream can rediscover
            // it by re-reading Postgres.
            self.publish_retirements(retired);
            // Tombstones only apply inside the snapshot commit, so they
            // count once it succeeds.
            report.cancellations_observed += cancellation_count;

            // Channel upkeep is best-effort: the poll remains the backstop,
            // so a failed watch call must not fail the sync that just
            // committed durable progress.
            if let Some(watch) = &self.watch
                && stored_calendar
                    .watch_expires_at
                    .is_none_or(|expires_at| expires_at < Utc::now() + WATCH_RENEWAL_THRESHOLD)
            {
                let channel_id = Uuid::new_v4();
                match self
                    .provider
                    .watch_calendar(
                        access_token,
                        key.email_link_id,
                        &watch_provider_calendar_id,
                        channel_id,
                        watch,
                    )
                    .await
                {
                    Ok(channel) => {
                        self.repository
                            .record_watch_channel(
                                key,
                                lease_token,
                                account_id,
                                calendar_id,
                                channel,
                            )
                            .await
                            .inspect_err(|error| {
                                tracing::warn!(
                                    error=?error,
                                    calendar_id=%calendar_id,
                                    "failed to record Google Calendar watch channel"
                                );
                            })
                            .ok();
                    }
                    Err(error) => {
                        tracing::warn!(
                            error=?error,
                            calendar_id=%calendar_id,
                            "failed to open Google Calendar watch channel"
                        );
                    }
                }
            }
        }

        // A calendar dropped from the provider's list retires its sources, so
        // the events it backed announce their own fate here too.
        let retired = self
            .repository
            .reconcile_google_calendar_list(key, lease_token, account_id, calendar_ids)
            .await?;
        self.publish_retirements(retired);

        Ok(())
    }
}

fn validate_upsert(upsert: &CalendarEventUpsert) -> Result<(), Report> {
    if upsert.event.owner_id.trim().is_empty() || upsert.event.ical_uid.trim().is_empty() {
        return Err(rootcause::report!(CalendarValidationError::MissingIdentity).into());
    }
    if !upsert.event.time.is_valid()
        || upsert
            .occurrences
            .iter()
            .any(|occurrence| !occurrence.time.is_valid())
        || upsert
            .overrides
            .iter()
            .any(|event_override| !event_override.time.is_valid())
    {
        return Err(rootcause::report!(CalendarValidationError::InvalidTime).into());
    }
    Ok(())
}

fn validate_query(range: &OccurrenceRange, limit: u16) -> Result<(), Report> {
    if !range.is_valid() || !range.is_materialized_at(Utc::now()) {
        return Err(rootcause::report!(CalendarValidationError::InvalidRange).into());
    }
    // One extra row lets the HTTP adapter report truncation accurately while
    // preserving its public maximum page size of 2,000.
    if !(1..=2001).contains(&limit) {
        return Err(rootcause::report!(CalendarValidationError::InvalidLimit).into());
    }
    Ok(())
}

#[cfg(test)]
mod test;
