use super::followups::{handle_attachment_upload, handle_contacts_sync, handle_thread_completed};
use super::*;
use crate::domain::backfill_jobs::BackfillJobRepository;
use models_email::service::{
    backfill::*,
    link::Link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
use uuid::Uuid;
/// Emit a `refresh_email` event once per this many completed threads, plus on
/// the first completed thread and at job completion, rather than per-thread.
/// The first-thread emit ensures backfills smaller than this interval still
/// surface a progress event before completing.
const REFRESH_EMAIL_THREAD_INTERVAL: i32 = 50;

/// called when a thread has completed processing. checks if it is the last thread to be processed
/// for the job, and if so, performs the necessary actions for job completion.
#[tracing::instrument(skip(ctx))]
pub(super) async fn incr_completed_threads<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let progress = ctx.effects.increment_threads(job_id).await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::RedisQueryFailed,
            source: e.context("Failed to increment completed thread count"),
        })
    })?;

    if progress.job_complete {
        tracing::info!(
            job_id = job_id.to_string(),
            "All threads for job have been processed"
        );
        handle_job_completed(ctx, job_id, None).await?;
    } else if progress.completed_threads == 1
        || progress.completed_threads % REFRESH_EMAIL_THREAD_INTERVAL == 0
    {
        ctx.effects
            .refresh_progress(&link.macro_id, link.id, progress)
            .await;
    }

    Ok(())
}

/// If this message was the last one in the thread to be processed, proceed to next stage of backfill for thread
#[tracing::instrument(skip(ctx))]
pub(super) async fn incr_completed_messages<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let thread_backfill_complete = ctx
        .effects
        .increment_messages(job_id, &p.thread_provider_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context(format!(
                    "Handle completed message for {} failed",
                    p.message_provider_id
                )),
            })
        })?;

    if thread_backfill_complete {
        handle_thread_completed(ctx, link, job_id, p).await?;
    }

    Ok(())
}

/// performs actions when all threads and messages have been backfilled for the user.
#[tracing::instrument(skip(ctx))]
pub(super) async fn handle_job_completed<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    job_id: Uuid,
    init_lease_token: Option<Uuid>,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    tracing::info!("Backfill complete for job {}", job_id);
    let outcome = ctx
        .repository
        .complete_job(job_id, init_lease_token)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to complete email backfill job"),
            })
        })?;

    completion_result(job_id, outcome)
}

fn completion_result(job_id: Uuid, outcome: BackfillCompletion) -> Result<(), ProcessingError> {
    match outcome {
        BackfillCompletion::Completed | BackfillCompletion::AlreadyTerminal => Ok(()),
        BackfillCompletion::LeaseLost => Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::EmailBackfillInitBusy,
            source: anyhow::anyhow!("email backfill completion lease was lost for job {job_id}"),
        })),
        BackfillCompletion::NotFound => Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::BackfillJobNotFound,
            source: anyhow::anyhow!("email backfill job {job_id} was not found"),
        })),
    }
}

/// Runs durable completion effects published from the completion outbox.
#[tracing::instrument(skip(ctx))]
pub(super) async fn finalize_backfill<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link_id: Uuid,
    job_id: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let Some(lease_token) = ctx
        .repository
        .claim_completion(job_id)
        .await
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to claim backfill completion effects"),
            })
        })?
    else {
        let pending = ctx
            .repository
            .completion_pending(job_id)
            .await
            .map_err(|error| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: error.context("Failed to load backfill completion effects"),
                })
            })?;
        if !pending {
            return Ok(());
        }
        return Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::anyhow!("backfill completion effects are already leased"),
        }));
    };

    let result = finalize_claimed_backfill(ctx, link_id, job_id, lease_token).await;
    if result.is_err() {
        ctx.repository
            .release_completion(job_id, lease_token)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    job_id = %job_id,
                    "failed to release backfill completion-effects lease"
                );
            })
            .ok();
    }
    result
}

async fn finalize_claimed_backfill<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link_id: Uuid,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let Some(job) = ctx
        .repository
        .jobs()
        .job(job_id)
        .await
        .map_err(crate::domain::mailbox::connection::ConnectionSourceError::into_original)
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to load completed backfill job"),
            })
        })?
    else {
        return Ok(());
    };
    match job.status {
        models_email::service::backfill::BackfillJobStatus::Complete => {}
        // A job that failed or was cancelled after its completion message
        // published will never become Complete; retrying such a delivery
        // only burns receives, so retire its effects instead.
        models_email::service::backfill::BackfillJobStatus::Failed
        | models_email::service::backfill::BackfillJobStatus::Cancelled => {
            tracing::warn!(%job_id, status = ?job.status, "retiring completion effects for a terminal, non-complete job");
            return retire_completion_effects(ctx, job_id, lease_token).await;
        }
        models_email::service::backfill::BackfillJobStatus::Init
        | models_email::service::backfill::BackfillJobStatus::InProgress => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::anyhow!(
                    "backfill completion effects published before job completion"
                ),
            }));
        }
    }
    let Some(canonical_link_id) = job.link_id else {
        return retire_completion_effects(ctx, job_id, lease_token).await;
    };
    if canonical_link_id != link_id {
        tracing::warn!(
            message_link_id = %link_id,
            canonical_link_id = %canonical_link_id,
            "using the completed backfill job's canonical link"
        );
    }
    let Some(link) = ctx
        .repository
        .link(canonical_link_id)
        .await
        .map_err(crate::domain::mailbox::connection::ConnectionSourceError::into_original)
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to load link for backfill completion"),
            })
        })?
    else {
        return retire_completion_effects(ctx, job_id, lease_token).await;
    };

    let effects = async {
        handle_attachment_upload(ctx, &link, job_id)
            .await
            .map_err(completion_effect_retry)?;
        handle_contacts_sync(ctx, &link)
            .await
            .map_err(completion_effect_retry)?;
        // Best effort: the mailbox now has sent mail to rank, so open direct
        // messages with the people the user emails most.
        ctx.effects.top_contact_dms(&link).await;
        ctx.effects
            .refresh_progress(
                &link.macro_id,
                canonical_link_id,
                BackfillProgress {
                    job_complete: true,
                    completed_threads: job.total_threads,
                    total_threads: job.total_threads,
                },
            )
            .await;
        Ok(())
    };
    tokio::pin!(effects);
    let lease_heartbeat = maintain_completion_effects_lease(ctx, job_id, lease_token);
    tokio::pin!(lease_heartbeat);
    tokio::select! {
        biased;
        lease_result = &mut lease_heartbeat => lease_result?,
        effects_result = &mut effects => effects_result?,
    }

    retire_completion_effects(ctx, job_id, lease_token).await
}

async fn maintain_completion_effects_lease<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let renewed = ctx
            .repository
            .renew_completion(job_id, lease_token)
            .await
            .map_err(|error| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: error.context("Failed to renew backfill completion-effects lease"),
                })
            })?;
        if !renewed {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: anyhow::anyhow!("backfill completion-effects lease was lost"),
            }));
        }
    }
}

async fn retire_completion_effects<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    job_id: Uuid,
    lease_token: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    ctx.repository
        .retire_completion(job_id, lease_token)
        .await
        .map_err(|error| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: error.context("Failed to finish backfill completion effects"),
            })
        })
}

fn completion_effect_retry(error: ProcessingError) -> ProcessingError {
    match error {
        ProcessingError::NonRetryable(detail) => ProcessingError::Retryable(detail),
        error => error,
    }
}
