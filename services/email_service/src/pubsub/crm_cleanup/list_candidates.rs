use crate::pubsub::crm_cleanup::worker::CrmCleanupContext;
use email_db_client::crm_cleanup::{candidates, job};
use models_email::email::service::crm_cleanup::{
    CrmCleanupJobStatus, CrmCleanupOperation, CrmCleanupPubsubMessage,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

/// Candidates dispatched per ListCandidates message.
const CANDIDATE_PAGE_SIZE: i64 = 200;

/// Dispatches one keyset page of cleanup candidates as `ProcessCandidate`
/// messages, then re-enqueues itself with the new cursor. Mirrors the
/// backfill `list_threads` pattern: each page is its own SQS message, so a
/// crash resumes from the last acked page. A short page means every id up to
/// the job's `max_candidate_id` snapshot has been dispatched — the job is
/// marked `Complete`.
///
/// A redelivered page re-publishes ProcessCandidate messages for pairs that
/// were already dispatched; that's harmless because the consumer's claim and
/// gate check are both idempotent.
#[tracing::instrument(skip(ctx), err)]
pub async fn list_candidates(
    ctx: &CrmCleanupContext,
    job_id: Uuid,
    last_id: i64,
) -> Result<(), ProcessingError> {
    let job = job::get_job(&ctx.db, job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch crm cleanup job"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::InvalidData,
                source: anyhow::anyhow!("Crm cleanup job not found: {job_id}"),
            })
        })?;

    match job.status {
        CrmCleanupJobStatus::Init | CrmCleanupJobStatus::InProgress => {}
        CrmCleanupJobStatus::Complete | CrmCleanupJobStatus::Failed => {
            tracing::warn!(job_id = %job_id, status = %job.status, "Stale ListCandidates message for finished job; acking");
            return Ok(());
        }
    }

    let page = candidates::list_candidates_page(
        &ctx.db,
        last_id,
        job.max_candidate_id,
        CANDIDATE_PAGE_SIZE,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to list crm cleanup candidates"),
        })
    })?;

    for candidate in &page {
        ctx.sqs_client
            .enqueue_email_crm_cleanup_message(CrmCleanupPubsubMessage {
                operation: CrmCleanupOperation::ProcessCandidate {
                    link_id: candidate.link_id,
                    contact_email: candidate.contact_email.clone(),
                },
            })
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue ProcessCandidate message"),
                })
            })?;
    }

    // Observability only; may over-count when a page is redelivered mid-dispatch.
    if !page.is_empty() {
        job::add_dispatched_count(&ctx.db, job_id, page.len() as i64)
            .await
            .inspect_err(|e| tracing::error!(error = ?e, "Failed to bump dispatched_count"))
            .ok();
    }

    if page.len() as i64 == CANDIDATE_PAGE_SIZE {
        let next_cursor = page.last().map(|c| c.id).unwrap_or(last_id);
        ctx.sqs_client
            .enqueue_email_crm_cleanup_message(CrmCleanupPubsubMessage {
                operation: CrmCleanupOperation::ListCandidates {
                    job_id,
                    last_id: next_cursor,
                },
            })
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to re-enqueue ListCandidates message"),
                })
            })?;
    } else {
        job::set_job_status(&ctx.db, job_id, CrmCleanupJobStatus::Complete)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to mark crm cleanup job complete"),
                })
            })?;
        tracing::info!(job_id = %job_id, dispatched = job.dispatched_count + page.len() as i64, "Crm cleanup job dispatch complete");
    }

    Ok(())
}
