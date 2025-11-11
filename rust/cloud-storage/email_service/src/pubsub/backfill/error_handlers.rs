use crate::pubsub::backfill::increment_counters;
use crate::pubsub::backfill::increment_counters::incr_completed_threads;
use crate::pubsub::context::PubSubContext;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillMessagePayload, BackfillOperation, BackfillPubsubMessage,
};
use models_email::email::service::pubsub::{DetailedError, ProcessingError};
use sqs_worker::cleanup_message;
use uuid::Uuid;

/// Handles non-retryable errors by updating the appropriate status in the database and cleaning up the SQS message
#[tracing::instrument(skip(ctx, message))]
pub async fn handle_non_retryable_error(
    ctx: &PubSubContext,
    message: &aws_sdk_sqs::types::Message,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::error!(error = %e, "Non-retryable error processing message. The message will be deleted.");

    match &data.backfill_operation {
        BackfillOperation::Init => {
            // update backfill job status to failed
            if let Err(db_err) = email_db_client::backfill::job::update::update_backfill_job_status(
                &ctx.db,
                data.job_id,
                BackfillJobStatus::Failed,
            )
            .await
            {
                tracing::error!(
                    error = %db_err,
                    "Failed to update backfill job status to Failed"
                );
            }
        }
        BackfillOperation::ListThreads(_) => {
            // update backfill job status to failed
            if let Err(db_err) = email_db_client::backfill::job::update::update_backfill_job_status(
                &ctx.db,
                data.job_id,
                BackfillJobStatus::Failed,
            )
            .await
            {
                tracing::error!(
                    error = %db_err,
                    "Failed to update backfill job status to Failed"
                );
            }
        }
        BackfillOperation::BackfillThread(_) => {
            handle_thread_failure(ctx, data.link_id, data.job_id).await;
        }
        BackfillOperation::BackfillMessage(p) => {
            handle_message_failure(ctx, data, p).await?;
        }
        BackfillOperation::UpdateThreadMetadata(_) => {
            handle_thread_failure(ctx, data.link_id, data.job_id).await;
        }
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument]
pub async fn handle_retryable_error(
    data: &BackfillPubsubMessage,
    _e: &DetailedError,
) -> anyhow::Result<()> {
    match &data.backfill_operation {
        BackfillOperation::Init => {
            tracing::debug!("Retryable error in Init")
        }
        BackfillOperation::ListThreads(_) => {
            tracing::debug!("Retryable error listing threads")
        }
        BackfillOperation::BackfillThread(p) => {
            tracing::debug!(
                thread_id = %p.thread_provider_id,
                "Retryable error backfilling thread"
            );
        }
        BackfillOperation::BackfillMessage(p) => {
            tracing::debug!(
                thread_id = %p.thread_provider_id,
                message_id = %p.message_provider_id,
                "Retryable error backfilling message"
            );
        }
        BackfillOperation::UpdateThreadMetadata(p) => {
            tracing::debug!(
                thread_id = %p.thread_provider_id,
                "Retryable error backfilling thread"
            );
        }
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_thread_failure(ctx: &PubSubContext, link_id: Uuid, job_id: Uuid) {
    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            tracing::error!(
                link_id = link_id.to_string(),
                job_id = job_id.to_string(),
                "Link not found"
            );
            return;
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                "Failed to fetch link"
            );
            return;
        }
    };

    if let Err(err) = incr_completed_threads(ctx, &link.macro_id, job_id).await {
        tracing::error!(
            error = %err,
            job_id = job_id.to_string(),
            "Failed to check if job is completed in handle thread failure"
        );
    }
}

#[tracing::instrument(skip(ctx))]
pub async fn handle_message_failure(
    ctx: &PubSubContext,
    data: &BackfillPubsubMessage,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    increment_counters::incr_completed_messages(ctx, data.link_id, data.job_id, p).await
}
