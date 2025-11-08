use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use crate::util::process_pre_insert::process_message_pre_insert;
use models_email::email::service::backfill::{
    BackfillMessagePayload, BackfillMessageStatus, BackfillOperation, BackfillPubsubMessage,
    UpdateMetadataPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::gmail::operations::GmailApiOperation;

/// This step is invoked by BackfillThread once for each message in the thread.
/// Creates a message object in the database. If the message is the last message in
/// the thread to be processed, it sends an UpdateThreadMetadata message for the thread.
#[tracing::instrument(skip(ctx, access_token))]
pub async fn backfill_message(
    ctx: &PubSubContext,
    access_token: &str,
    data: &BackfillPubsubMessage,
    link: &link::Link,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    // creates the backfill message or increments its retry count if it already exists
    email_db_client::backfill::message::upsert_backfill_message(
        &ctx.db,
        data.job_id,
        &p.thread_provider_id,
        &p.message_provider_id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to create backfill message record"),
        })
    })?;

    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::MessagesGet,
        true,
    )
    .await?;
    // get message from gmail
    let mut message = match ctx
        .gmail_client
        .get_message(access_token, &p.message_provider_id, link.id)
        .await
    {
        Ok(Some(message)) => message,
        Ok(None) => {
            return Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::MessageNotFoundInProvider,
                source: anyhow::anyhow!("Message {} not found in Gmail", p.message_provider_id),
            }));
        }
        Err(e) => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Gmail API failed to get message"),
            }));
        }
    };

    process_message_pre_insert(&ctx.db, &ctx.sfs_client, &mut message).await;

    // insert message into database
    email_db_client::messages::insert::insert_message(
        &ctx.db,
        p.thread_db_id,
        &mut message,
        link.id,
        // we update the thread metadata once all messages in the thread have been backfilled
        false,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to insert final message into database"),
        })
    })?;

    // Handle all success-related operations
    handle_message_success(ctx, link, data, p).await
}

/// Handles all success-related operations after a message has been successfully processed
#[tracing::instrument(skip(ctx))]
async fn handle_message_success(
    ctx: &PubSubContext,
    link: &link::Link,
    data: &BackfillPubsubMessage,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    // Update message status to completed
    email_db_client::backfill::message::update_backfill_message_status(
        &ctx.db,
        data.job_id,
        &p.thread_provider_id,
        &p.message_provider_id,
        BackfillMessageStatus::Completed,
        None,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context(format!(
                "Update backfill message status db call for {} failed",
                p.message_provider_id
            )),
        })
    })?;

    // Update thread-level counters
    let thread_counters = email_db_client::backfill::thread::record_message_success_in_thread(
        &ctx.db,
        data.job_id,
        &p.thread_provider_id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context(format!(
                "Record message success for {} failed",
                p.message_provider_id
            )),
        })
    })?;

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
            link_id: link.id,
            job_id: data.job_id,
            backfill_operation: BackfillOperation::UpdateThreadMetadata(new_payload),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue metadata message".to_string()),
                })
            })?;
    }

    Ok(())
}
