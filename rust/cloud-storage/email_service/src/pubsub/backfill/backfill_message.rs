use crate::pubsub::backfill::increment_counters;
use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use crate::util::process_pre_insert::process_message_pre_insert;
use models_email::email::service::backfill::{BackfillMessagePayload, BackfillPubsubMessage};
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
    increment_counters::incr_completed_messages(ctx, link.id, data.job_id, p).await
}
