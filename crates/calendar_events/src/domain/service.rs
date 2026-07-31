//! Calendar business policy.

use chrono::Utc;
use futures::future::{Either, select};
use rootcause::Report;
use uuid::Uuid;

use super::{
    models::{
        AppliedGoogleGrant, CalendarBackfillClaim, CalendarBackfillFailureDisposition,
        CalendarBackfillFailureOutcome, CalendarBackfillJobKey, CalendarEventUpsert,
        CalendarOccurrenceCursor, EmailCalendarBackfillState, EmailCalendarScanAssociation,
        EmailCalendarScanStatus, GoogleCalendarSyncSnapshot, GoogleScopeSet, OccurrenceRange,
    },
    ports::{
        CalendarBackfillRepository, CalendarEventWrite, CalendarOccurrenceService,
        CalendarRepository, EmailCalendarBackfillPublisher, EmailCalendarBackfillRepository,
        GoogleCalendarProvider, GoogleCalendarSyncRepository, GoogleEventSyncContext,
        GoogleProviderError, GoogleProviderErrorKind,
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
}

/// Queue-visible outcome of scheduling a full email rescan for ICS extraction.
#[derive(Debug, thiserror::Error)]
pub enum EmailCalendarBackfillRunError {
    /// An unrelated email scan is already in progress.
    #[error("email calendar extraction is waiting for the active email backfill")]
    Busy,
    /// The calendar job or its associated email scan was not found.
    #[error("email calendar extraction job was not found")]
    NotFound,
    /// The associated email scan already failed.
    #[error("email calendar extraction scan failed")]
    ScanFailed,
    /// Persistence or queue publication can be retried.
    #[error("email calendar extraction failed transiently: {0}")]
    Retryable(String),
}

/// Application service that associates a complete email scan with ICS extraction.
pub struct EmailCalendarBackfillCoordinator<R, P> {
    repository: R,
    publisher: P,
}

impl<R, P> EmailCalendarBackfillCoordinator<R, P>
where
    R: EmailCalendarBackfillRepository,
    P: EmailCalendarBackfillPublisher,
{
    /// Construct the coordinator from persistence and queue ports.
    pub fn new(repository: R, publisher: P) -> Self {
        Self {
            repository,
            publisher,
        }
    }

    /// Start or resume one durable email-ICS calendar backfill.
    #[tracing::instrument(skip(self, fusionauth_user_id), fields(job_id = %key.job_id), err)]
    pub async fn run(
        &self,
        key: CalendarBackfillJobKey,
        fusionauth_user_id: &str,
    ) -> Result<(), EmailCalendarBackfillRunError> {
        let state = self
            .repository
            .get_email_calendar_backfill_state(key)
            .await
            .map_err(retryable_email_backfill)?;
        let (email_job, allow_in_progress) = match state {
            EmailCalendarBackfillState::Complete => return Ok(()),
            EmailCalendarBackfillState::NotFound => {
                return Err(EmailCalendarBackfillRunError::NotFound);
            }
            EmailCalendarBackfillState::Associated { email_job_id } => {
                let job = self
                    .repository
                    .get_email_scan_job(key.email_link_id, email_job_id)
                    .await
                    .map_err(retryable_email_backfill)?
                    .ok_or(EmailCalendarBackfillRunError::NotFound)?;
                if !job.is_full_scan {
                    return Err(EmailCalendarBackfillRunError::ScanFailed);
                }
                (job, true)
            }
            EmailCalendarBackfillState::Unassociated => {
                let job = match self
                    .repository
                    .get_active_email_scan_job(key.email_link_id)
                    .await
                    .map_err(retryable_email_backfill)?
                {
                    Some(job) => job,
                    None => self
                        .repository
                        .create_email_scan_job(key.email_link_id, fusionauth_user_id)
                        .await
                        .map_err(retryable_email_backfill)?,
                };
                if !job.is_full_scan || job.status == EmailCalendarScanStatus::InProgress {
                    return Err(EmailCalendarBackfillRunError::Busy);
                }
                (job, false)
            }
        };

        let association = self
            .repository
            .associate_email_scan(key, email_job.id, allow_in_progress)
            .await
            .map_err(retryable_email_backfill)?;
        let status = match association {
            EmailCalendarScanAssociation::Associated(status) => status,
            EmailCalendarScanAssociation::Busy => {
                return Err(EmailCalendarBackfillRunError::Busy);
            }
            EmailCalendarScanAssociation::NotFound => {
                return Err(EmailCalendarBackfillRunError::NotFound);
            }
        };
        match status {
            EmailCalendarScanStatus::Complete => Ok(()),
            EmailCalendarScanStatus::Failed => Err(EmailCalendarBackfillRunError::ScanFailed),
            EmailCalendarScanStatus::InProgress => Ok(()),
            EmailCalendarScanStatus::Init => self
                .publisher
                .publish_email_scan_init(key.email_link_id, email_job.id)
                .await
                .map_err(retryable_email_backfill),
        }
    }

    /// Apply a terminal queue failure through the calendar lifecycle port.
    #[tracing::instrument(skip(self, message), fields(job_id = %key.job_id), err)]
    pub async fn fail_terminal(
        &self,
        key: CalendarBackfillJobKey,
        message: &str,
    ) -> Result<(), EmailCalendarBackfillRunError> {
        self.repository
            .fail_email_calendar_backfill(key, message)
            .await
            .map_err(retryable_email_backfill)?;
        Ok(())
    }
}

fn retryable_email_backfill(error: Report) -> EmailCalendarBackfillRunError {
    EmailCalendarBackfillRunError::Retryable(format!("{error:?}"))
}

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
    /// and inserts the two idempotent backfill jobs.
    #[tracing::instrument(skip(self, scopes), err)]
    pub async fn apply_google_grant(
        &self,
        email_link_id: Uuid,
        scopes: GoogleScopeSet,
    ) -> Result<AppliedGoogleGrant, Report> {
        self.repository
            .apply_google_grant(email_link_id, scopes)
            .await
    }

    /// Validate and atomically reconcile a provider or email source.
    #[tracing::instrument(skip(self, upsert), fields(ical_uid = %upsert.event.ical_uid), err)]
    pub async fn upsert_email_event(&self, upsert: CalendarEventUpsert) -> Result<Uuid, Report> {
        validate_upsert(&upsert)?;
        if !matches!(
            upsert.source,
            super::models::CalendarEventSource::EmailIcs(_)
        ) {
            return Err(rootcause::report!(
                "unfenced calendar ingestion only accepts email ICS sources"
            ));
        }
        self.repository
            .upsert_event(CalendarEventWrite::EmailIcs(upsert))
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
        self.repository
            .list_occurrences(requester_id, range, cursor, limit)
            .await
    }

    /// Return the aggregate ingestion state of the requester's visible accounts.
    #[tracing::instrument(skip(self, requester_id), err)]
    pub async fn sync_status(
        &self,
        requester_id: &str,
    ) -> Result<super::models::CalendarSyncStatus, Report> {
        self.repository.sync_status(requester_id).await
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
}

/// Orchestrates a Google account backfill while keeping HTTP and SQL behind ports.
pub struct GoogleCalendarBackfillService<R, G> {
    repository: R,
    provider: G,
}

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
pub struct GoogleCalendarBackfillCoordinator<R, G, L> {
    repository: R,
    provider: G,
    lifecycle: L,
}

impl<R, G, L> GoogleCalendarBackfillCoordinator<R, G, L>
where
    R: CalendarRepository + Clone,
    G: GoogleCalendarProvider + Clone,
    L: CalendarBackfillRepository,
{
    /// Construct a coordinator from domain ports.
    pub fn new(repository: R, provider: G, lifecycle: L) -> Self {
        Self {
            repository,
            provider,
            lifecycle,
        }
    }

    /// Execute one idempotent queue delivery under a fenced renewable lease.
    #[tracing::instrument(skip(self, owner_id, access_token, range), fields(job_id = %key.job_id), err)]
    pub async fn run(
        &self,
        key: CalendarBackfillJobKey,
        owner_id: &str,
        access_token: &str,
        range: OccurrenceRange,
    ) -> Result<usize, GoogleCalendarBackfillRunError> {
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
            CalendarBackfillClaim::Complete => return Ok(0),
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

        let backfill =
            GoogleCalendarBackfillService::new(self.repository.clone(), self.provider.clone());
        let work = backfill.backfill(key, lease_token, account_id, owner_id, access_token, range);
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
            Ok(count) => {
                self.lifecycle
                    .complete_google_backfill(key, lease_token, count)
                    .await
                    .map_err(|_| GoogleCalendarBackfillRunError::LeaseLost)?;
                Ok(count)
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

impl<R, G> GoogleCalendarBackfillService<R, G>
where
    R: CalendarRepository,
    G: GoogleCalendarProvider,
{
    /// Construct the provider backfill service.
    pub fn new(repository: R, provider: G) -> Self {
        Self {
            repository,
            provider,
        }
    }

    /// Fetch and reconcile calendars and events for a connected inbox.
    #[tracing::instrument(skip(self, owner_id, access_token, range), err)]
    pub async fn backfill(
        &self,
        key: CalendarBackfillJobKey,
        lease_token: Uuid,
        account_id: Uuid,
        owner_id: &str,
        access_token: &str,
        range: OccurrenceRange,
    ) -> Result<usize, Report> {
        if !range.is_valid_for_backfill() {
            return Err(rootcause::report!(CalendarValidationError::InvalidRange).into());
        }
        let calendars = self
            .provider
            .list_calendars(access_token)
            .await
            .map_err(|error| -> Report { rootcause::report!(error).into() })?;
        let mut count = 0;
        let mut calendar_ids = Vec::with_capacity(calendars.len());

        for provider_calendar in calendars {
            let provider_calendar_id = provider_calendar.provider_calendar_id.clone();
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
            let plan = stored_calendar.sync_plan(&range);
            let batch = self
                .provider
                .sync_events(
                    access_token,
                    GoogleEventSyncContext {
                        owner_id: owner_id.to_string(),
                        email_link_id: key.email_link_id,
                        account_id,
                        calendar_id,
                        provider_calendar_id,
                        is_read_only,
                        range: range.clone(),
                        sync_token: stored_calendar.sync_token,
                        plan,
                    },
                )
                .await
                .map_err(|error| -> Report { rootcause::report!(error).into() })?;
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
                if let super::models::CalendarEventSource::Google(source) = &upsert.source {
                    debug_assert_eq!(source.calendar_id, calendar_id);
                }
                self.repository
                    .upsert_event(CalendarEventWrite::GoogleBackfill {
                        key,
                        lease_token,
                        upsert,
                    })
                    .await?;
                count += 1;
            }
            // Committing per calendar keeps earlier calendars' sync tokens
            // durable when a later calendar's poll fails, so the retry only
            // re-pulls what never committed.
            self.repository
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
                )
                .await?;
        }

        self.repository
            .reconcile_google_calendar_list(key, lease_token, account_id, calendar_ids)
            .await?;

        Ok(count)
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
