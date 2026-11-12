//! Backfill-job access, cancellation, and initialization publication.

use models_email::service::{
    backfill::{BackfillJob, BackfillJobStatus},
    link::Link,
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Access already established by the request's authentication/inbox boundary.
#[derive(Clone, Copy)]
pub enum BackfillJobAccess {
    /// Public reads and cancellations are restricted to the selected inbox.
    Inbox(Uuid),
    /// Internal operations can address a job regardless of its inbox.
    Internal,
}

/// Stored facts and the existing atomic backfill-job writes.
pub trait BackfillJobRepository: Send + Sync + 'static {
    /// Original persistence failure, retaining its Debug text for legacy logs.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Read a job without an inbox restriction.
    fn job(&self, id: Uuid) -> impl Future<Output = Result<Option<BackfillJob>, Self::Err>> + Send;
    /// Read a job only when it belongs to this inbox.
    fn job_in_inbox(
        &self,
        id: Uuid,
        link: Uuid,
    ) -> impl Future<Output = Result<Option<BackfillJob>, Self::Err>> + Send;
    /// Read the caller's newest jobs, including those whose inbox was deleted.
    fn jobs_for_user(
        &self,
        fusion_id: &str,
    ) -> impl Future<Output = Result<Vec<BackfillJob>, Self::Err>> + Send;
    /// Read the stored active-job candidate for the inbox, if one exists.
    fn active_job(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Option<BackfillJob>, Self::Err>> + Send;
    /// Read the inbox facts needed to admit an initialization request.
    fn inbox(&self, link: Uuid) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
    /// Atomically insert a job, or return None when the active-job constraint conflicts.
    fn insert(
        &self,
        link: Uuid,
        fusion_id: &str,
        thread_limit: Option<i32>,
        is_recovery: bool,
    ) -> impl Future<Output = Result<Option<BackfillJob>, Self::Err>> + Send;
    /// Set a job's status using the existing unconditional status write.
    fn set_status(
        &self,
        id: Uuid,
        status: BackfillJobStatus,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Fail an active job after publication failed, preserving the existing transaction.
    fn fail_active(&self, id: Uuid) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Publishes the initialization of one already-persisted backfill job.
pub trait BackfillJobQueue: Send + Sync + 'static {
    /// Original queue failure, retaining its Debug text for legacy logs.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Enqueue exactly one initialization message.
    fn enqueue_initialization(
        &self,
        link: Uuid,
        job: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// A job could not be read within the caller's scope.
#[derive(Debug, thiserror::Error)]
pub enum BackfillLookupError<E> {
    /// The scoped query failed.
    #[error("backfill job lookup failed")]
    Query(#[source] E),
    /// No job exists within the selected scope.
    #[error("backfill job not found")]
    NotFound,
}

/// Cancellation was refused or could not be persisted.
#[derive(Debug, thiserror::Error)]
pub enum BackfillCancelError<E> {
    /// The job could not be read.
    #[error(transparent)]
    Lookup(#[from] BackfillLookupError<E>),
    /// A cancelled job cannot be cancelled again.
    #[error("backfill job already cancelled")]
    AlreadyCancelled,
    /// A completed job cannot be cancelled.
    #[error("backfill job already completed")]
    AlreadyComplete,
    /// A failed job cannot be cancelled.
    #[error("backfill job already failed")]
    AlreadyFailed,
    /// The status write failed.
    #[error("backfill job cancellation failed")]
    Update(#[source] E),
}

/// Initialization failed at one link; earlier links' work remains committed.
#[derive(Debug, thiserror::Error)]
pub enum BackfillCreateError<E, Q> {
    /// The inbox query failed.
    #[error("backfill inbox lookup failed for {link_id}")]
    InboxLookup {
        link_id: Uuid,
        #[source]
        source: E,
    },
    /// The requested inbox does not exist.
    #[error("backfill inbox not found: {0}")]
    InboxNotFound(Uuid),
    /// Backfill is unavailable for a disabled inbox.
    #[error("inbox sync is disabled: {0}")]
    SyncDisabled(Uuid),
    /// The atomic job insertion failed.
    #[error("backfill job insertion failed for {link_id}")]
    Insert {
        link_id: Uuid,
        #[source]
        source: E,
    },
    /// The active-job lookup after an insertion conflict failed.
    #[error("active backfill lookup failed for {link_id}")]
    ActiveLookup {
        link_id: Uuid,
        #[source]
        source: E,
    },
    /// The conflicting active job disappeared before it could be read.
    #[error("backfill insertion conflicted without an active job for {0}")]
    MissingActive(Uuid),
    /// Publication failed after the new job was marked failed.
    #[error("backfill publication failed for {link_id}")]
    Queue {
        link_id: Uuid,
        #[source]
        source: Q,
    },
    /// Publication and the subsequent failure-state write both failed.
    #[error("backfill publication cleanup failed for {link_id}")]
    Cleanup {
        link_id: Uuid,
        #[source]
        source: E,
    },
}

/// Owns public/internal job scope, cancellation policy, and initialization sequencing.
pub struct BackfillJobService<R, Q> {
    /// Reads and writes backfill facts without deciding the request's policy.
    pub repository: R,
    /// Publishes newly inserted jobs after persistence succeeds.
    pub queue: Q,
}

impl<R: BackfillJobRepository, Q> BackfillJobService<R, Q> {
    /// List jobs by the authentication identity, across owned and deleted inboxes.
    pub async fn list(&self, fusion_id: &str) -> Result<Vec<BackfillJob>, R::Err> {
        self.repository.jobs_for_user(fusion_id).await
    }

    /// Read the selected inbox's active job; absence is a successful empty result.
    pub async fn active(&self, link: Uuid) -> Result<Option<BackfillJob>, R::Err> {
        Ok(self.repository.active_job(link).await?.filter(|job| {
            matches!(
                job.status,
                BackfillJobStatus::Init | BackfillJobStatus::InProgress
            )
        }))
    }

    /// Apply inbox scope for public callers and unrestricted lookup for internal callers.
    pub async fn get(
        &self,
        id: Uuid,
        access: BackfillJobAccess,
    ) -> Result<BackfillJob, BackfillLookupError<R::Err>> {
        let job = match access {
            BackfillJobAccess::Inbox(link) => self.repository.job_in_inbox(id, link).await,
            BackfillJobAccess::Internal => self.repository.job(id).await,
        }
        .map_err(|e| {
            tracing::warn!(error=?e, "error fetching backfill job");
            BackfillLookupError::Query(e)
        })?;
        job.ok_or_else(|| {
            if let BackfillJobAccess::Inbox(link_id) = access {
                tracing::warn!(
                    "job not found during cancel backfill request for link_id {} job_id {}",
                    link_id,
                    id
                );
            }
            BackfillLookupError::NotFound
        })
    }

    /// Cancel only Init/InProgress jobs, retaining the public and internal missing-job logs.
    pub async fn cancel(
        &self,
        id: Uuid,
        access: BackfillJobAccess,
    ) -> Result<(), BackfillCancelError<R::Err>> {
        let job = self.get(id, access).await.inspect_err(|error| {
            if matches!(access, BackfillJobAccess::Internal)
                && matches!(error, BackfillLookupError::NotFound)
            {
                tracing::warn!("job not found for cancel backfill request: {}", id);
            }
        })?;
        match job.status {
            BackfillJobStatus::Cancelled => return Err(BackfillCancelError::AlreadyCancelled),
            BackfillJobStatus::Complete => return Err(BackfillCancelError::AlreadyComplete),
            BackfillJobStatus::Failed => return Err(BackfillCancelError::AlreadyFailed),
            BackfillJobStatus::Init | BackfillJobStatus::InProgress => {}
        }
        self.repository
            .set_status(job.id, BackfillJobStatus::Cancelled)
            .await
            .map_err(|e| {
                tracing::warn!(error=?e, "error updating backfill job status");
                BackfillCancelError::Update(e)
            })
    }
}

impl<R: BackfillJobRepository, Q: BackfillJobQueue> BackfillJobService<R, Q> {
    /// Insert or reuse jobs in request order, preserving duplicate links and the raw thread limit.
    pub async fn create(
        &self,
        links: Vec<Uuid>,
        thread_limit: Option<i32>,
    ) -> Result<Vec<(Uuid, Uuid)>, BackfillCreateError<R::Err, Q::Err>> {
        let mut pairs = Vec::new();
        for link_id in links {
            let link = self
                .repository
                .inbox(link_id)
                .await
                .map_err(|e| {
                    tracing::warn!(error=?e, "error fetching link for backfill");
                    BackfillCreateError::InboxLookup { link_id, source: e }
                })?
                .ok_or_else(|| {
                    tracing::warn!("link id not found for backfill: {}", link_id);
                    BackfillCreateError::InboxNotFound(link_id)
                })?;
            if !link.is_sync_active {
                return Err(BackfillCreateError::SyncDisabled(link_id));
            }
            let job = self
                .repository
                .insert(link.id, &link.fusionauth_user_id, thread_limit, false)
                .await
                .map_err(|e| {
                    tracing::warn!(error=?e, "error creating backfill_job");
                    BackfillCreateError::Insert { link_id, source: e }
                })?;
            let Some(job) = job else {
                let existing = self
                    .active(link.id)
                    .await
                    .map_err(|e| {
                        tracing::warn!(error=?e, "error fetching active backfill_job");
                        BackfillCreateError::ActiveLookup { link_id, source: e }
                    })?
                    .ok_or(BackfillCreateError::MissingActive(link_id))?;
                pairs.push((link_id, existing.id));
                continue;
            };
            pairs.push((link_id, job.id));
            if let Err(error) = self.queue.enqueue_initialization(link.id, job.id).await {
                tracing::error!(error = ?error, backfill_id = %job.id, "Failed to enqueue backfill message");
                self.repository
                    .fail_active(job.id)
                    .await
                    .inspect_err(|update_error| {
                        tracing::error!(
                            error = ?update_error,
                            backfill_id = %job.id,
                            "Failed to persist backfill publication failure"
                        );
                    })
                    .map_err(|source| BackfillCreateError::Cleanup { link_id, source })?;
                return Err(BackfillCreateError::Queue {
                    link_id,
                    source: error,
                });
            }
        }
        Ok(pairs)
    }
}
