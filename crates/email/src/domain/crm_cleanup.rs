//! Nightly candidate cleanup with the existing retry and job lifecycle policy.

mod list_candidates;
mod ports;
mod process_candidate;
mod start_job;
#[cfg(test)]
mod test;

pub use ports::*;

use models_email::service::crm_cleanup::{CrmCleanupJobStatus, CrmCleanupOperation};
use models_email::service::pubsub::ProcessingError;

/// The listener's final action after the domain has handled the operation.
pub enum CrmCleanupDisposition {
    /// Delete the delivery and return the acknowledgement result.
    Delete,
    /// Best-effort delete an invalid delivery and return its original decode error.
    InvalidDelete(anyhow::Error),
    /// Leave a retryable failure for redelivery, returning success to the worker loop.
    LeaveForRedelivery,
}

/// Coordinates cleanup jobs, candidates, CRM teardown and subsequent queue work.
pub struct CrmCleanupService<R, C, Q, T> {
    /// Job, candidate, and mailbox persistence capabilities.
    pub repository: R,
    /// The existing CRM domain service operations.
    pub crm_service: C,
    /// Cleanup operation publication.
    pub queue: Q,
    /// The original wall-clock sampling sites.
    pub clock: T,
}

impl<R, C, Q, T> CrmCleanupService<R, C, Q, T>
where
    R: CleanupJobs + CleanupCandidates + CleanupMailbox,
    C: CleanupCrm,
    Q: CleanupQueue,
    T: CleanupClock,
{
    /// Apply the existing operation policy and choose the delivery's final disposition.
    pub async fn process(
        &self,
        extracted: anyhow::Result<CrmCleanupOperation>,
    ) -> CrmCleanupDisposition {
        let data = match extracted {
            Ok(data) => data,
            Err(e) => {
                tracing::error!(error = %e, "Failed to extract crm cleanup message, this is non-retryable.");
                return CrmCleanupDisposition::InvalidDelete(e);
            }
        };

        match inner_process_message(self, &data).await {
            Ok(()) => CrmCleanupDisposition::Delete,
            Err(ProcessingError::NonRetryable(e)) => {
                tracing::error!(error = ?e, operation = ?data, "Non-retryable crm cleanup error");
                if let CrmCleanupOperation::ListCandidates { job_id, .. } = &data
                    && let Err(status_err) = self
                        .repository
                        .set_job_status(*job_id, CrmCleanupJobStatus::Failed)
                        .await
                {
                    tracing::error!(error = ?status_err, job_id = %job_id, "Failed to mark crm cleanup job as failed");
                }
                CrmCleanupDisposition::Delete
            }
            Err(ProcessingError::Retryable(e)) => {
                tracing::warn!(error = ?e, operation = ?data, "Retryable crm cleanup error; message will be redelivered");
                CrmCleanupDisposition::LeaveForRedelivery
            }
        }
    }
}

// The operation is skipped: a candidate carries a contact's address.
#[tracing::instrument(skip(ctx, data))]
async fn inner_process_message<R, C, Q, T>(
    ctx: &CrmCleanupService<R, C, Q, T>,
    data: &CrmCleanupOperation,
) -> Result<(), ProcessingError>
where
    R: CleanupJobs + CleanupCandidates + CleanupMailbox,
    C: CleanupCrm,
    Q: CleanupQueue,
    T: CleanupClock,
{
    match data {
        CrmCleanupOperation::StartJob => start_job::start_job(ctx).await,
        CrmCleanupOperation::ListCandidates { job_id, last_id } => {
            list_candidates::list_candidates(ctx, *job_id, *last_id).await
        }
        CrmCleanupOperation::ProcessCandidate {
            link_id,
            contact_email,
        } => process_candidate::process_candidate(ctx, *link_id, contact_email).await,
    }
}
