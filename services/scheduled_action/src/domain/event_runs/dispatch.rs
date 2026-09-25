//! Current-owner preparation, one fenced start, and terminal bookkeeping.

use std::sync::Arc;

use futures::FutureExt;

use super::*;
use crate::domain::models::MAX_ACTION_TIME;

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

pub struct EventDispatchService<R, A, E> {
    repository: Arc<R>,
    access: Arc<A>,
    executor: Arc<E>,
}

impl<R, A, E> EventDispatchService<R, A, E> {
    pub fn new(repository: Arc<R>, access: Arc<A>, executor: Arc<E>) -> Self {
        Self {
            repository,
            access,
            executor,
        }
    }
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, E: EventExecutor> EventDispatchService<R, A, E> {
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
}

impl<R: EventRunRepository, A: CurrentOwnerAccess, E: EventExecutor> EventRunDispatch
    for EventDispatchService<R, A, E>
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
