use crate::pubsub::backfill::backfill_attachment::backfill_attachment;
use crate::pubsub::backfill::{
    backfill_attachment, backfill_message, backfill_thread, error_handlers, init, list_threads,
    update_metadata,
};
use crate::pubsub::context::PubSubContext;
use crate::util::gmail::auth::fetch_gmail_access_token_from_link;
use anyhow::Context;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;

// Process a single message from the backfill queue
pub async fn process_message(
    ctx: PubSubContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    // Malformed JSON is NOT retryable.
    let data = match extract_backfill_message(message) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract message, this is non-retryable.");
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            return Err(e);
        }
    };

    let processing_result = inner_process_message(&ctx, &data).await;

    match processing_result {
        // Processing success. Clean up the message
        Ok(()) => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }

        // A permanent failure occurred. We clean up the message to prevent it from being retried
        Err(ProcessingError::NonRetryable(e)) => {
            error_handlers::handle_non_retryable_error(&ctx, message, &data, &e).await
        }

        // A temporary failure occurred. We log it and don't clean up the message, so it gets retried
        Err(ProcessingError::Retryable(e)) => {
            error_handlers::handle_retryable_error(&data, &e).await
        }
    }
}

#[tracing::instrument(skip(ctx))]
async fn inner_process_message(
    ctx: &PubSubContext,
    data: &BackfillPubsubMessage,
) -> Result<(), ProcessingError> {
    let backfill_job = email_db_client::backfill::job::get::get_backfill_job(&ctx.db, data.job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch backfill job"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::BackfillJobNotFound,
                source: anyhow::anyhow!("Backfill job not found"),
            })
        })?;

    if backfill_job.status == BackfillJobStatus::Cancelled {
        let _ = handle_cancel_backfill_job(ctx, data).await;
        return Ok(());
    }

    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, data.link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            let err_msg = format!("Link not found for link_id: {}", data.link_id);
            tracing::error!("{}", err_msg);
            return Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::LinkNotFound,
                source: anyhow::anyhow!(err_msg),
            }));
        }
        Err(e) => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e,
            }));
        }
    };

    let access_token = fetch_gmail_access_token_from_link(
        link.clone(),
        &ctx.redis_client,
        &ctx.auth_service_client,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::AccessTokenFetchFailed,
            source: e.context("Failed to fetch access token from link"),
        })
    })?;

    match &data.backfill_operation {
        BackfillOperation::Init => {
            init::init_backfill(ctx, &access_token, data, &link, &backfill_job).await?
        }
        BackfillOperation::ListThreads(p) => {
            list_threads::list_threads(ctx, &access_token, data, &link, p, &backfill_job).await?
        }
        BackfillOperation::BackfillThread(p) => {
            backfill_thread::backfill_thread(ctx, &access_token, data, &link, p).await?
        }
        BackfillOperation::BackfillMessage(p) => {
            backfill_message::backfill_message(ctx, &access_token, data, &link, p).await?
        }
        BackfillOperation::UpdateThreadMetadata(p) => {
            update_metadata::update_thread_metadata(ctx, data, &link, p).await?
        }
        BackfillOperation::BackfillAttachment(p) => {
            backfill_attachment::backfill_attachment(ctx, &access_token, &link, p).await?
        }
    };

    Ok(())
}

/// Extracts backfill message from the SQS message body
#[tracing::instrument(skip(message))]
fn extract_backfill_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<BackfillPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    // Deserialize the JSON string into a BackfillPubsubMessage
    let backfill_message: BackfillPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to BackfillPubsubMessage")?;

    Ok(backfill_message)
}

// set unprocessed records to cancelled if the job was cancelled
async fn handle_cancel_backfill_job(
    ctx: &PubSubContext,
    data: &BackfillPubsubMessage,
) -> anyhow::Result<()> {
    let _ = ctx
        .redis_client
        .delete_backfill_job_progress(data.job_id)
        .await;

    match &data.backfill_operation {
        BackfillOperation::Init => Ok(()),
        BackfillOperation::ListThreads(_) => Ok(()),
        BackfillOperation::BackfillThread(_) => Ok(()),
        BackfillOperation::BackfillMessage(p) => {
            let _ = ctx
                .redis_client
                .delete_backfill_thread_progress(data.job_id, &p.thread_provider_id)
                .await;
            Ok(())
        }
        BackfillOperation::UpdateThreadMetadata(_) => Ok(()),
    }
}
