use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use crate::util::process_pre_insert::sync_labels::sync_labels;
use crate::util::sync_contacts::sync_contacts;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillOperation, BackfillPubsubMessage,
};
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_email::email::service::thread::ListThreadsPayload;
use models_email::email::service::{backfill, link};
use models_email::gmail::operations::GmailApiOperation;
use std::cmp::min;

/// This step is invoked via the API when a new job is created.
/// Populates total_threads value in backfill_job row, and sends the first ListThreads message.
#[tracing::instrument(skip(ctx, access_token))]
pub async fn init_backfill(
    ctx: &PubSubContext,
    access_token: &str,
    data: &BackfillPubsubMessage,
    link: &link::Link,
    backfill_job: &backfill::BackfillJob,
) -> Result<(), ProcessingError> {
    tracing::info!("Initializing backfill job");

    // ensure we have the user's labels in the db
    sync_labels(&ctx.db, &ctx.gmail_client, access_token, link.id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to sync labels"),
            })
        })?;

    if let Err(e) = sync_contacts(
        link,
        &ctx.db,
        &ctx.gmail_client,
        &ctx.sqs_client,
        access_token,
    )
    .await
    {
        tracing::error!(error = ?e, "Failed to sync contacts");
    }

    let threads_requested_limit = backfill_job.threads_requested_limit;

    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::UsersGetProfile,
        true,
    )
    .await?;
    // get the total number of threads the user has in their account
    let total_threads = match ctx
        .gmail_client
        .get_profile_threads_total(access_token)
        .await
    {
        Ok(list) => list,
        Err(e) => {
            // Construct the structured Retryable error and return immediately.
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to get total threads from Gmail API"),
            }));
        }
    };

    // If thread count is not specified, populate all available threads. Otherwise,
    // populate up to the requested number or total available, whichever is smaller
    let total_threads = match threads_requested_limit {
        Some(requested) => min(total_threads, requested),
        None => total_threads,
    };

    email_db_client::backfill::job::update::update_job_total_threads(
        &ctx.db,
        data.job_id,
        total_threads,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to update total_threads"),
        })
    })?;

    ctx.redis_client.init_backfill_job_progress(data.job_id, total_threads).await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to create entry in redis for job"),
            })
        })?;

    let thread_sqs_msg = BackfillPubsubMessage {
        link_id: data.link_id,
        job_id: data.job_id,
        backfill_operation: BackfillOperation::ListThreads(ListThreadsPayload {
            next_page_token: None, // a value of None tells the process to start from the beginning
        }),
    };

    ctx.sqs_client
        .enqueue_email_backfill_message(thread_sqs_msg)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e.context("Failed to enqueue initial ListThreads message".to_string()),
            })
        })?;

    email_db_client::backfill::job::update::update_backfill_job_status(
        &ctx.db,
        data.job_id,
        BackfillJobStatus::InProgress,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to update backfill job status to InProgress"),
        })
    })?;

    Ok(())
}
