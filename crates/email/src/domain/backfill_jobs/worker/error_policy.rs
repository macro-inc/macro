use super::*;
use crate::domain::backfill_jobs::BackfillJobRepository;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    pubsub::{DetailedError, FailureReason},
};
use std::time::Duration;
use uuid::Uuid;

/// Handles non-retryable errors by updating the appropriate status in the database and cleaning up the SQS message
pub async fn handle_non_retryable_error<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    tracing::error!(
        error = %e,
        source = { format!("{:#}", e.source) },
        "Non-retryable error processing message. The message will be deleted."
    );

    match &data.backfill_operation {
        BackfillOperation::Init(scope) => mark_job_failed(ctx, scope.job_id).await?,
        BackfillOperation::ListThreads(scope) => mark_job_failed(ctx, scope.job_id).await?,
        BackfillOperation::BackfillThread(scope) => {
            handle_thread_failure(ctx, scope.link_id, scope.job_id).await?;
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            handle_thread_failure(ctx, scope.link_id, scope.job_id).await?;
        }
        BackfillOperation::BackfillMessage(scope) => {
            handle_message_failure(ctx, scope).await?;
        }
        BackfillOperation::BackfillAttachment(_) => {}
        BackfillOperation::FinalizeBackfill(scope) => {
            // The message is about to be deleted; without republishing the
            // completion-outbox row, the backfill would finish silently
            // missing attachment fan-out, contacts sync, and the final
            // refresh event. Deterministic failures resurface via the DLQ.
            ctx.repository.republish_completion(scope.job_id).await;
        }
        // Best-effort side seed — a failure must not fail the backfill job.
        BackfillOperation::SeedSentContact(_) => {}
        BackfillOperation::PopulateCrmContact(_) => {}
        BackfillOperation::DepopulateCrmContact(_) => {}
        BackfillOperation::PopulateCrmForUser(_) => {}
        BackfillOperation::DepopulateCrmForUser(_) => {}
    }

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn mark_job_failed<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    job_id: Uuid,
) -> anyhow::Result<()>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let transitioned = ctx
        .repository
        .jobs()
        .fail_active(job_id)
        .await
        .map_err(ConnectionSourceError::into_original)?;

    if transitioned {
        notify_job_failed(ctx, job_id).await;
    }
    Ok(())
}

/// Resolves the failed job's link and signals the failure over the connection
/// gateway so an active client stops waiting on the job.
#[tracing::instrument(skip(ctx))]
async fn notify_job_failed<R, G, Q, E, C>(ctx: &BackfillService<R, G, Q, E, C>, job_id: Uuid)
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let Ok(Some(job)) = ctx.repository.jobs().job(job_id).await else {
        return;
    };
    let Some(link_id) = job.link_id else {
        return;
    };

    if let Ok(Some(link)) = ctx.repository.link(link_id).await {
        ctx.effects.notify_failed(&link).await;
    }
}

/// Sends a rate-limited operation back to the queue after a growing delay
/// (see [`deferral`]), keeping its delivery budget for real failures. If the
/// send fails, the message is left for redelivery after its visibility timeout.
pub async fn defer_rate_limited_operation<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
    deferrals: u32,
    retry_after: Option<Duration>,
) -> anyhow::Result<BackfillDeferral>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let delay_seconds = deferral::delay_seconds(deferrals, retry_after);
    if let Err(error) = ctx.queue.defer(data, delay_seconds, deferrals + 1).await {
        tracing::warn!(error = ?error, "Failed to defer a rate-limited backfill operation; it will be redelivered");
        handle_retryable_error(data, e).await?;
        return Ok(BackfillDeferral::LeaveForRedelivery);
    }
    tracing::debug!(
        deferrals,
        delay_seconds,
        "Rate-limited backfill operation deferred"
    );
    Ok(BackfillDeferral::Delete)
}

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument(
    skip(data, _e),
    fields(link_id = ?data.backfill_operation.link_id(), error = tracing::field::Empty)
)]
pub async fn handle_retryable_error(
    data: &BackfillPubsubMessage,
    _e: &DetailedError,
) -> anyhow::Result<()> {
    let error_chain = format!("{:#}", _e.source);
    tracing::Span::current().record("error", &error_chain);

    // Rate limits and busy write slots are expected backpressure, redelivered
    // after the visibility timeout; the email API client logs provider
    // throttling at ERROR.
    if matches!(
        _e.reason,
        FailureReason::GmailApiRateLimited | FailureReason::BackfillWritesBusy
    ) {
        tracing::debug!("Refused backfill operation will be redelivered");
        return Ok(());
    }

    match &data.backfill_operation {
        BackfillOperation::Init(_) => {
            tracing::warn!("Retryable error in Init")
        }
        BackfillOperation::ListThreads(_) => {
            tracing::warn!("Retryable error listing threads")
        }
        BackfillOperation::BackfillThread(scope) => {
            tracing::warn!(
                thread_id = %scope.payload.thread_provider_id,
                "Retryable error backfilling thread"
            );
        }
        BackfillOperation::BackfillMessage(scope) => {
            tracing::warn!(
                thread_id = %scope.payload.thread_provider_id,
                message_id = %scope.payload.message_provider_id,
                "Retryable error backfilling message"
            );
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            tracing::warn!(
                thread_id = %scope.payload.thread_provider_id,
                "Retryable error updating thread metadata"
            );
        }
        BackfillOperation::BackfillAttachment(scope) => {
            tracing::warn!(
                attachment_db_id = %scope.payload.metadata.attachment_metadata.attachment_db_id,
                "Retryable error backfilling attachment"
            )
        }
        BackfillOperation::FinalizeBackfill(scope) => {
            tracing::warn!(
                job_id = %scope.job_id,
                "Retryable error finalizing completed backfill"
            )
        }
        BackfillOperation::SeedSentContact(scope) => {
            tracing::warn!(
                message_id = %scope.payload.message_provider_id,
                "Retryable error seeding contact from sent message"
            )
        }
        BackfillOperation::PopulateCrmContact(scope) => {
            tracing::warn!(
                link_id = %scope.link_id,
                "Retryable error populating CRM contact"
            )
        }
        BackfillOperation::DepopulateCrmContact(scope) => {
            tracing::warn!(
                link_id = %scope.link_id,
                "Retryable error depopulating CRM contact"
            )
        }
        BackfillOperation::PopulateCrmForUser(_) => {
            tracing::warn!("Retryable error populating CRM for user")
        }
        BackfillOperation::DepopulateCrmForUser(payload) => {
            tracing::warn!(
                team_id = %payload.team_id,
                "Retryable error depopulating CRM for user"
            )
        }
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_thread_failure<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link_id: Uuid,
    job_id: Uuid,
) -> anyhow::Result<()>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let link = match ctx.repository.link(link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Link is gone — `incr_completed_threads` can't run without
            // it, so this thread will never complete on its own. Mark the
            // parent job failed instead of silently dropping the message
            // (the SQS message gets cleaned up after this returns, so a
            // silent return strands the job in InProgress forever).
            tracing::error!(
                link_id = link_id.to_string(),
                job_id = job_id.to_string(),
                "Link not found in handle_thread_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, job_id).await?;
            return Ok(());
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                job_id = job_id.to_string(),
                "Failed to fetch link in handle_thread_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, job_id).await?;
            return Ok(());
        }
    };

    if let Err(err) = super::counters::incr_completed_threads(ctx, &link, job_id).await {
        tracing::error!(
            error = %err,
            job_id = job_id.to_string(),
            "Failed to check if job is completed in handle thread failure"
        );
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
pub async fn handle_message_failure<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    scope: &JobScopedPayload<BackfillMessagePayload>,
) -> anyhow::Result<()>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let link = match ctx.repository.link(scope.link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Same defense as handle_thread_failure — without a link we
            // can't increment counters, and a silent return leaves the
            // parent job in InProgress forever after the SQS message is
            // cleaned up.
            tracing::error!(
                link_id = scope.link_id.to_string(),
                job_id = scope.job_id.to_string(),
                "Link not found in handle_message_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, scope.job_id).await?;
            return Ok(());
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                job_id = scope.job_id.to_string(),
                "Failed to fetch link in handle_message_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, scope.job_id).await?;
            return Ok(());
        }
    };

    if let Err(err) =
        super::counters::incr_completed_messages(ctx, &link, scope.job_id, &scope.payload).await
    {
        tracing::error!(
            error = %err,
            job_id = scope.job_id.to_string(),
            "Failed to check if thread is completed in handle message failure"
        );
    }
    Ok(())
}
