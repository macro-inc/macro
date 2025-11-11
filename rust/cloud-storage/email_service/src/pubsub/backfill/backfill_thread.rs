use crate::pubsub::backfill::increment_counters::incr_completed_threads;
use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use models_email::email::service::backfill::{
    BackfillMessagePayload, BackfillOperation, BackfillPubsubMessage, BackfillThreadPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::gmail::operations::GmailApiOperation;
use std::collections::HashSet;

/// This step is invoked by ListThreads for each thread being backfilled.
/// Creates the thread object in the database, fetches the message ids for the thread
/// from the gmail api, and sends a BackfillMessage message for each message_id.
#[tracing::instrument(skip(ctx, access_token))]
pub async fn backfill_thread(
    ctx: &PubSubContext,
    access_token: &str,
    data: &BackfillPubsubMessage,
    link: &link::Link,
    p: &BackfillThreadPayload,
) -> Result<(), ProcessingError> {
    let thread_provider_id = p.thread_provider_id.clone();

    let existing_threads = email_db_client::threads::get::get_threads_by_link_id_and_provider_ids(
        &ctx.db,
        link.id,
        &HashSet::from_iter(vec![thread_provider_id.clone()]),
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context(format!(
                "DB check for existing thread {} failed",
                thread_provider_id
            )),
        })
    })?;

    // if the thread already exists, skip backfilling and update redis counters
    if !existing_threads.is_empty() {
        incr_completed_threads(ctx, &link.macro_id, data.job_id).await?;
        return Ok(());
    }

    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::ThreadsGet,
        true,
    )
    .await?;
    // fetch all message_ids of the thread
    let message_ids = match ctx
        .gmail_client
        .get_message_ids_for_thread(access_token, &thread_provider_id)
        .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context(format!(
                    "Gmail API failed to get message IDs for thread {}",
                    thread_provider_id
                )),
            }));
        }
    };

    ctx.redis_client
        .init_backfill_thread_progress(data.job_id, &thread_provider_id, message_ids.len() as i32)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context(format!(
                    "Failed to create entry in redis for thread {}",
                    &thread_provider_id
                )),
            })
        })?;

    // insert thread object
    let thread_db_id = email_db_client::threads::insert::insert_blank_thread(
        &ctx.db,
        &thread_provider_id,
        link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context(format!(
                "Failed to insert thread shell for {}",
                thread_provider_id
            )),
        })
    })?;

    // create backfill pubsub message for each email message
    for message_id in message_ids.clone() {
        let new_payload = BackfillMessagePayload {
            thread_provider_id: p.thread_provider_id.clone(),
            thread_db_id,
            message_provider_id: message_id.clone(),
        };

        let ps_message = BackfillPubsubMessage {
            link_id: link.id,
            job_id: data.job_id,
            backfill_operation: BackfillOperation::BackfillMessage(new_payload),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context(format!("Failed to enqueue message {}", message_id)),
                })
            })?;
    }

    Ok(())
}
