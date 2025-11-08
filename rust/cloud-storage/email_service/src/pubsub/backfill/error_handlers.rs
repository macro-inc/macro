use crate::pubsub::context::PubSubContext;
use models_email::email::service::backfill::UpdateMetadataPayload;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillMessagePayload, BackfillMessageStatus, BackfillOperation,
    BackfillPubsubMessage, BackfillThreadStatus,
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
        BackfillOperation::BackfillThread(p) => {
            handle_thread_failure(
                ctx,
                data.job_id,
                &p.thread_provider_id,
                &e.reason.to_string(),
            )
            .await;
        }
        BackfillOperation::BackfillMessage(p) => {
            handle_message_failure(ctx, data, p, &e.reason.to_string()).await?;
        }
        BackfillOperation::UpdateThreadMetadata(p) => {
            handle_thread_failure(
                ctx,
                data.job_id,
                &p.thread_provider_id,
                &e.reason.to_string(),
            )
            .await;
        }
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument(skip(ctx))]
pub async fn handle_retryable_error(
    ctx: &PubSubContext,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
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

            // update error_message of backfill_thread but keep status as InProgress
            if let Err(db_err) = email_db_client::backfill::thread::update_backfill_thread_status(
                &ctx.db,
                data.job_id,
                &p.thread_provider_id,
                BackfillThreadStatus::InProgress,
                Some(e.reason.to_string()),
            )
            .await
            {
                tracing::error!(
                    error = %db_err,
                    thread_id = %p.thread_provider_id,
                    "Failed to update backfill thread error message"
                );
            }
        }
        BackfillOperation::BackfillMessage(p) => {
            tracing::debug!(
                thread_id = %p.thread_provider_id,
                message_id = %p.message_provider_id,
                "Retryable error backfilling message"
            );

            // update error message of backfill_message but keep status as InProgress
            if let Err(db_err) = email_db_client::backfill::message::update_backfill_message_status(
                &ctx.db,
                data.job_id,
                &p.thread_provider_id,
                &p.message_provider_id,
                BackfillMessageStatus::InProgress,
                Some(e.reason.to_string()),
            )
            .await
            {
                tracing::error!(
                    error = %db_err,
                    thread_id = %p.thread_provider_id,
                    message_id = %p.message_provider_id,
                    "Failed to update backfill message error message"
                );
            }
        }
        BackfillOperation::UpdateThreadMetadata(p) => {
            tracing::debug!(
                thread_id = %p.thread_provider_id,
                "Retryable error backfilling thread"
            );

            // update error_message of backfill_thread but keep status as InProgress
            if let Err(db_err) = email_db_client::backfill::thread::update_backfill_thread_status(
                &ctx.db,
                data.job_id,
                &p.thread_provider_id,
                BackfillThreadStatus::InProgress,
                Some(e.reason.to_string()),
            )
            .await
            {
                tracing::error!(
                    error = %db_err,
                    thread_id = %p.thread_provider_id,
                    "Failed to update backfill thread error message"
                );
            }
        }
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_thread_failure(
    ctx: &PubSubContext,
    job_id: Uuid,
    thread_provider_id: &str,
    error_reason: &str,
) {
    // update status of backfill_thread entry to failed
    if let Err(db_err) = email_db_client::backfill::thread::update_backfill_thread_status(
        &ctx.db,
        job_id,
        thread_provider_id,
        BackfillThreadStatus::Failed,
        Some(error_reason.to_string()),
    )
    .await
    {
        tracing::error!(
            error = %db_err,
            "Failed to update backfill thread status to Failed"
        );
    }

    // update counters in backfill_job
    if let Err(db_err) =
        email_db_client::backfill::job::update::record_thread_failure_in_job(&ctx.db, job_id).await
    {
        tracing::error!(
            error = %db_err,
            "Failed to record backfill thread failure"
        );
    }
}

#[tracing::instrument(skip(ctx))]
pub async fn handle_message_failure(
    ctx: &PubSubContext,
    data: &BackfillPubsubMessage,
    p: &BackfillMessagePayload,
    error_reason: &str,
) -> Result<(), ProcessingError> {
    // Update status of backfill_message entry to failed
    if let Err(db_err) = email_db_client::backfill::message::update_backfill_message_status(
        &ctx.db,
        data.job_id,
        &p.thread_provider_id,
        &p.message_provider_id,
        BackfillMessageStatus::Failed,
        Some(error_reason.to_string()),
    )
    .await
    {
        tracing::error!(
            error = %db_err,
            "Failed to update backfill message status to Failed"
        );
    }

    // Update thread-level counters
    let thread_counters = match email_db_client::backfill::thread::record_message_failure_in_thread(
        &ctx.db,
        data.job_id,
        &p.thread_provider_id,
    )
    .await
    {
        Ok(counters) => counters,
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                "Failed to record backfill message failure in thread"
            );
            return Ok(());
        }
    };

    // If this is the last message to be processed in the thread, we can move on to updating the
    // thread metadata.
    let thread_backfill_complete =
        thread_counters.messages_processed_count >= thread_counters.messages_retrieved_count;

    if thread_backfill_complete {
        let new_payload = UpdateMetadataPayload {
            thread_provider_id: p.thread_provider_id.clone(),
            thread_db_id: p.thread_db_id,
        };

        let ps_message = BackfillPubsubMessage {
            link_id: Uuid::default(), // UpdateThreadMetadata doesn't use this, and we don't have it
            job_id: data.job_id,
            backfill_operation: BackfillOperation::UpdateThreadMetadata(new_payload),
        };

        if let Err(e) = ctx
            .sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
        {
            tracing::error!(
                error = %e,
                "Failed to enqueue metadata message for thread_id {}",
                p.thread_provider_id
            );
        }
    }

    Ok(())
}
