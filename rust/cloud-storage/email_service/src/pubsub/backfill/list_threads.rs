use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use models_email::email::service::backfill::{
    BackfillJob, BackfillOperation, BackfillPubsubMessage, BackfillThreadPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::email::service::thread::ListThreadsPayload;
use models_email::gmail::operations::GmailApiOperation;
use std::cmp::min;

// the max size allowed by the gmail api
const BACKFILL_THREAD_BATCH_SIZE: u32 = 5;

/// This step is invoked by Init.
/// Each ListThreads operation gets a batch of 500 thread_ids from the gmail api
/// and sends a BackfillThread message for each thread_id in the batch. If there
/// are still threads left to fetch, it will trigger another ListThreads message
/// to be created, looping until all threads requiring population have been listed.
pub async fn list_threads(
    ctx: &PubSubContext,
    access_token: &str,
    data: &BackfillPubsubMessage,
    link: &link::Link,
    p: &ListThreadsPayload,
    job: &BackfillJob,
) -> Result<(), ProcessingError> {
    let total_threads = job.total_threads;
    let threads_retrieved_count = job.threads_retrieved_count;

    let num_threads_to_list = min(
        BACKFILL_THREAD_BATCH_SIZE as i32,
        total_threads - threads_retrieved_count,
    );

    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::ThreadsList,
        true,
    )
    .await?;
    // get batch of thread ids
    let thread_list = match ctx
        .gmail_client
        .list_threads(
            access_token,
            num_threads_to_list as u32,
            p.next_page_token.as_deref(),
        )
        .await
    {
        Ok(list) => list,
        Err(e) => {
            // Construct the structured Retryable error and return immediately.
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to list threads from Gmail API"),
            }));
        }
    };

    // pass along token if it exists for fetching next batch of thread_ids
    let next_page_token = thread_list.next_page_token.clone();

    // add the threads we just discovered to the job counter
    email_db_client::backfill::job::update::update_job_threads_retrieved_count(
        &ctx.db,
        data.job_id,
        thread_list.threads.len() as i32,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to update backfill job num_threads"),
        })
    })?;

    // send a pubsub message for each discovered thread
    for thread in thread_list.threads {
        let thread_sqs_msg = BackfillPubsubMessage {
            link_id: data.link_id,
            job_id: data.job_id,
            backfill_operation: BackfillOperation::BackfillThread(BackfillThreadPayload {
                thread_provider_id: thread.provider_id.clone(),
            }),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(thread_sqs_msg)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context(format!("Failed to enqueue thread {}", thread.provider_id)),
                })
            })?;
    }

    // if we have more threads to fetch, send another pubsub message
    if next_page_token.is_some() {
        let list_thread_msg = BackfillPubsubMessage {
            link_id: data.link_id,
            job_id: data.job_id,
            backfill_operation: BackfillOperation::ListThreads(ListThreadsPayload {
                next_page_token,
            }),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(list_thread_msg)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue list threads message".to_string()),
                })
            })?;
    }

    Ok(())
}
