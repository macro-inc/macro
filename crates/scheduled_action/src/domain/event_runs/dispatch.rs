//! Current-owner preparation, one fenced start, and terminal bookkeeping.

use std::sync::Arc;

use futures::FutureExt;

use super::condition::{ConditionError, ConditionVerdict, EventConditionCheck, NoConditionCheck};
use super::*;
use crate::domain::event_trigger::ConditionRequirement;
use crate::domain::models::{ConditionResult, MAX_ACTION_TIME};

/// How long after admission a condition that cannot be checked is retried
/// before the run is skipped as unavailable.
pub const CONDITION_RETRY_WINDOW: chrono::Duration = chrono::Duration::minutes(10);

#[cfg(test)]
mod test;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DispatchResult {
    Cancelled(CancellationReason),
    /// Another worker won, the action is busy, or configuration changed.
    NotStarted,
    Finished(FinalizationResult),
}

/// Worker-facing use cases; transport scheduling does not decide eligibility.
pub trait EventRunDispatch: Send + Sync + 'static {
    fn pending(
        &self,
        limit: PageSize,
    ) -> impl Future<Output = Result<Vec<PendingEventRun>, Report>> + Send;
    fn reconcile(&self, limit: PageSize) -> impl Future<Output = Result<u16, Report>> + Send;
    /// Errors before claim leave work pending. Errors after claim leave it
    /// started for deadline reconciliation, never available for execution again.
    fn dispatch(
        &self,
        pending: PendingEventRun,
        cancellation: impl Future<Output = ()> + Send,
    ) -> impl Future<Output = Result<DispatchResult, Report>> + Send;
}

pub struct EventDispatchService<R, A, E, C = NoConditionCheck> {
    repository: Arc<R>,
    access: Arc<A>,
    executor: Arc<E>,
    conditions: Arc<C>,
}

impl<R, A, E> EventDispatchService<R, A, E> {
    /// Without [`Self::with_conditions`], conditional runs are skipped as unavailable.
    pub fn new(repository: Arc<R>, access: Arc<A>, executor: Arc<E>) -> Self {
        Self {
            repository,
            access,
            executor,
            conditions: Arc::new(NoConditionCheck),
        }
    }
}

impl<R, A, E, C> EventDispatchService<R, A, E, C> {
    pub fn with_conditions<D>(self, conditions: Arc<D>) -> EventDispatchService<R, A, E, D> {
        EventDispatchService {
            repository: self.repository,
            access: self.access,
            executor: self.executor,
            conditions,
        }
    }
}

impl<R: EventRunRepository, A, E, C> EventDispatchService<R, A, E, C> {
    async fn cancel(
        &self,
        pending: &PendingEventRun,
        reason: CancellationReason,
    ) -> Result<DispatchResult, Report> {
        self.repository
            .cancel_pending(pending.key(), pending.revision, reason)
            .await?;
        Ok(DispatchResult::Cancelled(reason))
    }

    async fn skip(
        &self,
        pending: &PendingEventRun,
        condition: ConditionResult,
    ) -> Result<DispatchResult, Report> {
        let reason = match condition {
            ConditionResult::NotMet { .. } => CancellationReason::ConditionNotMet,
            ConditionResult::Unavailable => CancellationReason::ConditionUnavailable,
        };
        let record = ActionExecutionRecord::skipped(pending.action_id, Utc::now(), condition);
        self.repository
            .skip_pending(pending.key(), pending.revision, reason, record)
            .await?;
        Ok(DispatchResult::Cancelled(reason))
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, E: EventExecutor, C: EventConditionCheck>
    EventRunDispatch for EventDispatchService<R, A, E, C>
{
    async fn pending(&self, limit: PageSize) -> Result<Vec<PendingEventRun>, Report> {
        self.repository.pending_runs(limit).await
    }

    async fn reconcile(&self, limit: PageSize) -> Result<u16, Report> {
        self.repository.reconcile(Utc::now(), limit).await
    }

    async fn dispatch(
        &self,
        pending: PendingEventRun,
        cancellation: impl Future<Output = ()> + Send,
    ) -> Result<DispatchResult, Report> {
        let Some(configuration) = self
            .repository
            .current_configuration(pending.action_id)
            .await?
        else {
            return self.cancel(&pending, CancellationReason::Superseded).await;
        };
        if let Err(reason) = configuration.check_pending(&pending) {
            return self.cancel(&pending, reason).await;
        }
        let Owner::User(owner) = &configuration.owner else {
            return self
                .cancel(&pending, CancellationReason::NotUserOwned)
                .await;
        };
        // Unavailability propagates without cancelling or claiming queued work.
        let Some(access) = self.access.authorize(owner, &pending.event).await? else {
            return self
                .cancel(&pending, CancellationReason::AccessDenied)
                .await;
        };
        let authorized = match AuthorizedEventRun::prepare(pending.clone(), &configuration, access)
        {
            Ok(run) => run,
            Err(reason) => return self.cancel(&pending, reason).await,
        };
        if let ConditionRequirement::AnyOf(conditions) =
            configuration.filters.condition_requirement(&pending.event)
        {
            match self.conditions.check(owner, &authorized, &conditions).await {
                Ok(ConditionVerdict::Met(_)) => {}
                Ok(ConditionVerdict::NotMet(probability)) => {
                    let probability = probability.get();
                    return self
                        .skip(&pending, ConditionResult::NotMet { probability })
                        .await;
                }
                // Unavailability leaves the run pending for a later attempt
                // until the window closes, like authorization above.
                Err(ConditionError::Transient(error))
                    if Utc::now() < pending.admitted_at + CONDITION_RETRY_WINDOW =>
                {
                    return Err(error);
                }
                Err(error) => {
                    tracing::warn!(
                        action_id = %pending.action_id,
                        error = ?error,
                        outcome = "condition_unavailable",
                        "skipping event run whose condition could not be checked"
                    );
                    return self.skip(&pending, ConditionResult::Unavailable).await;
                }
            }
        }
        let mut cancellation = std::pin::pin!(cancellation);
        // Authorization may have been in flight when intake stopped. Do not
        // start a fresh claim after shutdown; already-started claims are terminal.
        if cancellation.as_mut().now_or_never().is_some() {
            return Ok(DispatchResult::NotStarted);
        }
        let started_at = Utc::now();
        let Some(run) = self
            .repository
            .claim(
                authorized,
                ClaimToken::generate(),
                started_at,
                started_at + MAX_ACTION_TIME,
            )
            .await?
        else {
            return Ok(DispatchResult::NotStarted);
        };
        // The committed claim is the linearization point. Do not reload config
        // or undo execution for a disable/update after this point.
        let execution = self.executor.execute(&run, cancellation).await;
        let finalized = self
            .repository
            .finalize(FinalizeEventRun {
                key: run.run.pending.key(),
                token: run.token,
                finished_at: Utc::now(),
                execution,
            })
            .await?;
        Ok(DispatchResult::Finished(finalized))
    }
}
