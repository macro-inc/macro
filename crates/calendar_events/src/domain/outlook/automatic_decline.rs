//! Explicit out-of-office policy. A submission is journaled before the provider
//! action; an uncertain response is only observed again, never submitted twice.
use super::*;
use chrono::{DateTime, Utc};

/// One occurrence considered by the automatic decline policy.
#[derive(Clone, Debug)]
pub struct AwayOccurrence {
    /// Current provider occurrence identity, used for the eventual action.
    pub provider_id: String,
    /// Actual interval, including all-day local-midnight conversion.
    pub starts_at: DateTime<Utc>,
    /// Exclusive end of this occurrence.
    pub ends_at: DateTime<Utc>,
    /// Provider creation instant; new-only policies compare this to enablement.
    pub created_at: DateTime<Utc>,
    /// Whether this calendar owner organizes the event.
    pub is_organizer: bool,
    /// Whether this copy is cancelled.
    pub cancelled: bool,
    /// Owner's current invitation response.
    pub response: AttendeeResponseStatus,
    /// Explicit Macro policy, present only while the event is still out of office.
    pub policy: Option<AutomaticDeclinePolicy>,
}
/// Persisted identities are candidates only; fresh provider facts decide actions.
#[derive(Clone, Debug)]
pub struct AwayCandidate {
    /// Out-of-office master or single event.
    pub away_id: String,
    /// Selected out-of-office occurrence, if recurring.
    pub away_recurrence: Option<String>,
    /// Invitation master or single event.
    pub invitation_id: String,
    /// Only this invitation occurrence may be declined.
    pub invitation_recurrence: Option<String>,
}
/// Whether the provider accepted a response attempt or definitely deferred it.
pub enum AwaySubmissionOutcome {
    /// A provider request may have been accepted; reconcile it without resending.
    Submitted,
    /// No action was accepted. The domain may retry after this backoff.
    Deferred(u32),
}
/// Previously submitted request whose outcome still needs observation.
pub struct AwaySubmission {
    /// Durable identity of this submission.
    pub id: Uuid,
    /// Master/single event to look up, even if its occurrence moved.
    pub invitation_id: String,
    /// Original occurrence identity.
    pub recurrence_id: Option<String>,
}
/// Persistence operations are fenced by the current calendar lease and grant.
pub trait AutomaticDeclineRepository: Send + Sync + 'static {
    /// Possible overlaps from committed projections, excluding already submitted invitations.
    fn away_candidates(
        &self,
        lease: &OutlookCalendarLease,
    ) -> impl Future<Output = Result<Vec<AwayCandidate>, Report>> + Send;
    /// Submitted operations that must never be retried as new actions.
    fn away_submissions(
        &self,
        lease: &OutlookCalendarLease,
    ) -> impl Future<Output = Result<Vec<AwaySubmission>, Report>> + Send;
    /// Durable compare-and-swap before any provider decline. None means already submitted.
    fn begin_away_submission(
        &self,
        lease: &OutlookCalendarLease,
        candidate: &AwayCandidate,
    ) -> impl Future<Output = Result<Option<Uuid>, Report>> + Send;
    /// Record an observation, delaying another check when still unresolved.
    fn observe_away_submission(
        &self,
        lease: &OutlookCalendarLease,
        id: Uuid,
        confirmed: bool,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Release only a request known not to have been submitted.
    fn defer_away_submission(
        &self,
        lease: &OutlookCalendarLease,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Yield a checked candidate to other work, including ineligible candidates.
    fn record_away_check(
        &self,
        lease: &OutlookCalendarLease,
        candidate: &AwayCandidate,
        delay: u32,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
/// Provider IO exposes facts, not invitation-decline policy.
pub trait AutomaticDeclineProvider: Send + Sync + 'static {
    /// Read the requested occurrence, including current response and policy.
    fn away_occurrence(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        id: &str,
        recurrence: Option<&str>,
    ) -> impl Future<Output = Result<Option<AwayOccurrence>, CalendarProviderError>> + Send;
    /// Submit exactly once; the caller journals first and reconciles failures.
    fn decline_away_invitation(
        &self,
        token: &str,
        target: &ProviderCalendarTarget,
        invitation: &str,
        comment: Option<&str>,
    ) -> impl Future<Output = Result<AwaySubmissionOutcome, CalendarProviderError>> + Send;
}

/// Only the account owner's explicit away rule authorizes an automatic reply.
pub fn should_decline(
    away: &AwayOccurrence,
    invitation: &AwayOccurrence,
    now: DateTime<Utc>,
) -> bool {
    let Some(policy) = &away.policy else {
        return false;
    };
    if !away.is_organizer
        || away.cancelled
        || invitation.is_organizer
        || invitation.cancelled
        || invitation.response == AttendeeResponseStatus::Declined
        || invitation.ends_at <= now
        || away.starts_at >= invitation.ends_at
        || invitation.starts_at >= away.ends_at
    {
        return false;
    }
    match policy.properties.auto_decline_mode {
        OutOfOfficeAutoDeclineMode::DeclineNone => false,
        OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations => true,
        OutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations => {
            invitation.created_at >= policy.enabled_at
        }
    }
}

/// Reconcile old submissions even when new provider writes are paused.
pub async fn run<R, P>(
    repository: &R,
    provider: &P,
    lease: &OutlookCalendarLease,
    token: &str,
    writes: bool,
) -> Result<(), CalendarProviderError>
where
    R: OutlookCalendarRepository + AutomaticDeclineRepository,
    P: AutomaticDeclineProvider,
{
    let Some(target) = lease.target.as_ref() else {
        return Ok(());
    };
    for submission in repository
        .away_submissions(lease)
        .await
        .map_err(storage_error)?
    {
        let observed = provider
            .away_occurrence(
                token,
                target,
                &submission.invitation_id,
                submission.recurrence_id.as_deref(),
            )
            .await;
        let confirmed = match observed {
            Ok(observed) => observed.as_ref().is_none_or(|event| {
                event.cancelled || event.response == AttendeeResponseStatus::Declined
            }),
            Err(error) => {
                tracing::warn!(kind=?error.kind(),"Automatic reply outcome read will retry");
                false
            }
        };
        repository
            .observe_away_submission(lease, submission.id, confirmed)
            .await
            .map_err(storage_error)?;
    }
    if !writes || target.is_read_only {
        return Ok(());
    }
    for candidate in repository
        .away_candidates(lease)
        .await
        .map_err(storage_error)?
    {
        let attempt = async {
            let Some(away) = provider
                .away_occurrence(
                    token,
                    target,
                    &candidate.away_id,
                    candidate.away_recurrence.as_deref(),
                )
                .await?
            else {
                return Ok::<u32, CalendarProviderError>(120);
            };
            let Some(invitation) = provider
                .away_occurrence(
                    token,
                    target,
                    &candidate.invitation_id,
                    candidate.invitation_recurrence.as_deref(),
                )
                .await?
            else {
                return Ok(120);
            };
            if !should_decline(&away, &invitation, Utc::now()) {
                return Ok(120);
            }
            repository
                .renew_outlook_calendar(lease)
                .await
                .map_err(storage_error)?;
            let Some(id) = repository
                .begin_away_submission(lease, &candidate)
                .await
                .map_err(storage_error)?
            else {
                return Ok(120);
            };
            match provider
                .decline_away_invitation(
                    token,
                    target,
                    &invitation.provider_id,
                    away.policy
                        .as_ref()
                        .and_then(|p| p.properties.decline_message.as_deref()),
                )
                .await?
            {
                AwaySubmissionOutcome::Submitted => Ok(120),
                AwaySubmissionOutcome::Deferred(delay) => {
                    repository
                        .defer_away_submission(lease, id)
                        .await
                        .map_err(storage_error)?;
                    Ok(delay.clamp(1, 86400))
                }
            }
        }
        .await;
        let delay = match attempt {
            Ok(delay) => delay,
            Err(error) => {
                tracing::warn!(kind=?error.kind(),"Automatic invitation reply needs reconciliation");
                120
            }
        };
        // Every candidate advances, so bad provider data or an ineligible
        // overlap cannot starve later invitations or block ordinary sync.
        repository
            .record_away_check(lease, &candidate, delay)
            .await
            .map_err(storage_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod test;
