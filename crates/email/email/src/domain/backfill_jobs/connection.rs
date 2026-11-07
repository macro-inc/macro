//! Initial backfill publication for a newly connected inbox.

use super::{BackfillJobQueue, BackfillJobRepository, BackfillJobService};
use models_email::service::link::Link;
use uuid::Uuid;

pub trait ConnectedInboxHistory: Send + Sync + 'static {
    /// Record connection history best-effort, retaining diagnostics on failure.
    fn record(&self, link: &Link) -> impl Future<Output = ()> + Send;
}

pub trait ConnectedInboxEvents: Send + Sync + 'static {
    fn connected(&self, link: &Link);
}

#[derive(Debug, thiserror::Error)]
pub enum InitialBackfillError<E> {
    #[error("initial backfill lookup failed")]
    Active(E),
    #[error("initial backfill insertion failed")]
    Insert(E),
    #[error("initial backfill conflict lookup failed")]
    ConflictLookup(E),
    #[error("backfill insert conflicted but no active job found")]
    MissingActive,
    #[error("initial backfill failure-state write failed")]
    FailureState(E),
    #[error("Failed to enqueue backfill message")]
    Enqueue,
}

impl<R: BackfillJobRepository, Q: BackfillJobQueue> BackfillJobService<R, Q> {
    /// Reuse active work; publish history and the connection event only for a new job.
    pub async fn start_connected<H: ConnectedInboxHistory, E: ConnectedInboxEvents>(
        &self,
        link: &Link,
        history: &H,
        events: &E,
    ) -> Result<Uuid, InitialBackfillError<R::Err>> {
        if let Some(existing) = self
            .repository
            .active_job(link.id)
            .await
            .map_err(InitialBackfillError::Active)?
        {
            return Ok(existing.id);
        }
        let Some(job) = self
            .repository
            .insert(link.id, &link.fusionauth_user_id, None, false)
            .await
            .map_err(InitialBackfillError::Insert)?
        else {
            let existing = self
                .repository
                .active_job(link.id)
                .await
                .map_err(InitialBackfillError::ConflictLookup)?
                .ok_or(InitialBackfillError::MissingActive)?;
            return Ok(existing.id);
        };
        history.record(link).await;
        events.connected(link);
        if let Err(e) = self.queue.enqueue_initialization(link.id, job.id).await {
            tracing::error!(error = ?e, backfill_id = %job.id, "Failed to enqueue backfill message");
            self.repository
                .fail_active(job.id)
                .await
                .map_err(InitialBackfillError::FailureState)?;
            return Err(InitialBackfillError::Enqueue);
        }
        Ok(job.id)
    }
}
