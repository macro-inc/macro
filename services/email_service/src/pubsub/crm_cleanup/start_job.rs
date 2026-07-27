use crate::pubsub::crm_cleanup::worker::CrmCleanupContext;
use email_db_client::crm_cleanup::{candidates, job};
use models_email::email::service::crm_cleanup::{
    CrmCleanupJob, CrmCleanupJobStatus, CrmCleanupOperation, CrmCleanupPubsubMessage,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// An active job whose `updated_at` hasn't moved for this long is considered
/// stranded (e.g. its lister exhausted retries into the DLQ) and gets failed
/// so it can't block future nights. A healthy job's `updated_at` advances
/// with every dispatched page, and a full run takes minutes, not hours.
const STALE_ACTIVE_JOB_MAX_AGE_HOURS: i64 = 12;

/// Nightly kickoff, delivered by EventBridge as a static payload: snapshots
/// the candidate table, creates the job row, and enqueues the first
/// `ListCandidates` message.
///
/// Idempotent under duplicate fires and redeliveries: `create_job` no-ops
/// against the one-active-job unique index, and an existing job still in
/// `Init` (a previous kickoff died before enqueueing its lister) is resumed
/// rather than skipped. An active job that has sat untouched for
/// [`STALE_ACTIVE_JOB_MAX_AGE_HOURS`] is failed and replaced, so a job
/// stranded by retry exhaustion can't block cleanup forever.
#[tracing::instrument(skip(ctx), err)]
pub async fn start_job(ctx: &CrmCleanupContext) -> Result<(), ProcessingError> {
    // Freeze the working set: candidates inserted after this point get higher
    // ids and wait for the next nightly run.
    let snapshot = candidates::get_max_id_and_count(&ctx.db)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to snapshot crm cleanup candidates"),
            })
        })?;

    let Some((max_id, count)) = snapshot else {
        tracing::info!("No crm cleanup candidates; skipping job creation");
        return Ok(());
    };

    let created = job::create_job(&ctx.db, count, max_id).await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to create crm cleanup job"),
        })
    })?;

    let cleanup_job: CrmCleanupJob = match created {
        Some(created_job) => created_job,
        None => {
            let active = job::get_active_job(&ctx.db)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to fetch active crm cleanup job"),
                    })
                })?
                .ok_or_else(|| {
                    // The active job finished between create and fetch; the
                    // next nightly fire picks up any remaining candidates.
                    ProcessingError::NonRetryable(DetailedError {
                        reason: FailureReason::InvalidData,
                        source: anyhow::anyhow!(
                            "Active crm cleanup job disappeared between create and fetch"
                        ),
                    })
                })?;

            let age = chrono::Utc::now() - active.updated_at;
            if age > chrono::Duration::hours(STALE_ACTIVE_JOB_MAX_AGE_HOURS) {
                // Stranded job (its lister likely DLQ'd): fail it and start
                // fresh so the one-active-job index doesn't block cleanup.
                tracing::warn!(job_id = %active.id, status = %active.status, age_hours = age.num_hours(), "Active crm cleanup job is stale; failing it and starting a new one");
                job::set_job_status(&ctx.db, active.id, CrmCleanupJobStatus::Failed)
                    .await
                    .map_err(|e| {
                        ProcessingError::Retryable(DetailedError {
                            reason: FailureReason::DatabaseQueryFailed,
                            source: e.context("Failed to fail stale crm cleanup job"),
                        })
                    })?;

                let fresh = job::create_job(&ctx.db, count, max_id).await.map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to create replacement crm cleanup job"),
                    })
                })?;
                let Some(fresh) = fresh else {
                    // A concurrent kickoff won the replacement race.
                    tracing::warn!("Another kickoff created the replacement job; skipping");
                    return Ok(());
                };
                fresh
            } else {
                match active.status {
                    // A previous kickoff created the job but died before
                    // enqueueing its lister — resume it.
                    CrmCleanupJobStatus::Init => active,
                    _ => {
                        tracing::warn!(job_id = %active.id, status = %active.status, "An active crm cleanup job already exists; skipping kickoff");
                        return Ok(());
                    }
                }
            }
        }
    };

    tracing::info!(job_id = %cleanup_job.id, total_candidates = cleanup_job.total_candidates, max_candidate_id = cleanup_job.max_candidate_id, "Starting crm cleanup job");

    ctx.sqs_client
        .enqueue_email_crm_cleanup_message(CrmCleanupPubsubMessage {
            operation: CrmCleanupOperation::ListCandidates {
                job_id: cleanup_job.id,
                last_id: 0,
            },
        })
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e.context("Failed to enqueue first ListCandidates message"),
            })
        })?;

    // Lister handles Init too, so a failure here only costs observability.
    job::set_job_status(&ctx.db, cleanup_job.id, CrmCleanupJobStatus::InProgress)
        .await
        .inspect_err(
            |e| tracing::error!(error = ?e, job_id = %cleanup_job.id, "Failed to mark job in progress"),
        )
        .ok();

    Ok(())
}
