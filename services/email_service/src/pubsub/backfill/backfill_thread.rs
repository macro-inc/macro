use crate::pubsub::backfill::db_error::map_db_error;
use crate::pubsub::backfill::email_api_error::map_email_api_error;
use crate::pubsub::backfill::increment_counters::incr_completed_threads;
use crate::pubsub::context::PubSubContext;
use models_email::email::service::backfill::{
    BackfillMessagePayload, BackfillOperation, BackfillPubsubMessage, BackfillThreadPayload,
    JobScopedPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::collections::HashSet;

/// This step is invoked by ListThreads for each thread being backfilled.
/// Creates the thread object in the database, fetches the message ids for the thread
/// from the gmail api, and sends a BackfillMessage message for each message_id.
#[tracing::instrument(skip(ctx))]
pub async fn backfill_thread(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &link::Link,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;
    let thread_provider_id = p.thread_provider_id.clone();

    let existing_threads = email_db_client::threads::get::get_threads_by_link_id_and_provider_ids(
        &ctx.db,
        link.id,
        &HashSet::from_iter(vec![thread_provider_id.clone()]),
    )
    .await
    .map_err(|e| {
        map_db_error(
            e,
            format!("DB check for existing thread {} failed", thread_provider_id),
        )
    })?;

    // If the thread already exists: recovery jobs refresh it (backfilling any
    // messages that arrived in the sync gap), other jobs skip it and update
    // redis counters.
    if let Some(existing_thread_db_id) = existing_threads.get(&thread_provider_id) {
        if p.refresh_existing {
            return refresh_existing_thread(ctx, scope, link, *existing_thread_db_id).await;
        }
        incr_completed_threads(ctx, link, scope.job_id).await?;
        return Ok(());
    }

    // fetch all message_ids of the thread
    let message_ids = ctx
        .email_api
        .get_message_ids_for_thread(link.id, &thread_provider_id)
        .await
        .map_err(|error| map_email_api_error(error, "Failed to get provider thread message IDs"))?;

    // insert thread object
    let thread_db_id = email_db_client::threads::insert::insert_blank_thread(
        &ctx.db,
        &thread_provider_id,
        link.id,
    )
    .await
    .map_err(|e| {
        map_db_error(
            e,
            format!("Failed to insert thread shell for {}", thread_provider_id),
        )
    })?;

    // create backfill pubsub message for each email message
    enqueue_backfill_messages(ctx, scope, link, thread_db_id, message_ids).await
}

/// Recovery-job path for a thread that is already in the database: fetch the
/// provider's message ids and backfill only the messages we are missing, so
/// replies that arrived during a sync gap are recovered.
///
/// Job accounting matches the fresh-thread path: with nothing missing the
/// thread completes immediately (like the skip path); otherwise its redis
/// progress counter is initialized to the missing count and the enqueued
/// messages complete it.
async fn refresh_existing_thread(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &link::Link,
    thread_db_id: uuid::Uuid,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;

    let message_ids = ctx
        .email_api
        .get_message_ids_for_thread(link.id, &p.thread_provider_id)
        .await
        .map_err(|error| map_email_api_error(error, "Failed to get provider thread message IDs"))?;

    let existing_message_ids =
        email_db_client::messages::get::filter_existing_provider_message_ids(
            &ctx.db,
            link.id,
            &message_ids,
        )
        .await
        .map_err(|e| {
            map_db_error(
                e,
                format!(
                    "DB check for existing messages of thread {} failed",
                    p.thread_provider_id
                ),
            )
        })?;

    let missing_message_ids: Vec<String> = message_ids
        .into_iter()
        .filter(|message_id| !existing_message_ids.contains(message_id))
        .collect();

    if missing_message_ids.is_empty() {
        return incr_completed_threads(ctx, link, scope.job_id).await;
    }

    enqueue_backfill_messages(ctx, scope, link, thread_db_id, missing_message_ids).await
}

/// Initializes the thread's redis progress counter and enqueues one
/// BackfillMessage per message id.
async fn enqueue_backfill_messages(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<BackfillThreadPayload>,
    link: &link::Link,
    thread_db_id: uuid::Uuid,
    message_ids: Vec<String>,
) -> Result<(), ProcessingError> {
    let p = &scope.payload;

    ctx.redis_client
        .init_backfill_thread_progress(
            scope.job_id,
            &p.thread_provider_id,
            message_ids.len() as i32,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context(format!(
                    "Failed to create entry in redis for thread {}",
                    &p.thread_provider_id
                )),
            })
        })?;

    for message_id in message_ids {
        let new_payload = BackfillMessagePayload {
            thread_provider_id: p.thread_provider_id.clone(),
            thread_db_id,
            message_provider_id: message_id.clone(),
        };

        let ps_message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::BackfillMessage(JobScopedPayload {
                link_id: link.id,
                job_id: scope.job_id,
                payload: new_payload,
            }),
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
