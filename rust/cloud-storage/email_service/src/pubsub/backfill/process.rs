use crate::pubsub::backfill::{
    backfill_attachment, backfill_message, backfill_thread, depopulate_crm_contact,
    depopulate_crm_for_user, error_handlers, init, list_threads, populate_crm_contact,
    populate_crm_for_user, update_metadata,
};
use crate::pubsub::context::PubSubContext;
use crate::util::gmail::auth::fetch_token_or_mark_reauth;
use anyhow::Context;
use models_email::email::service::backfill::{
    BackfillJob, BackfillJobStatus, BackfillOperation, BackfillPubsubMessage, JobScopedPayload,
};
use models_email::email::service::link;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;
use uuid::Uuid;

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
    match &data.backfill_operation {
        BackfillOperation::Init(scope) => {
            let Some(JobContext {
                link,
                backfill_job,
                access_token,
            }) = fetch_job_context(ctx, scope).await?
            else {
                return Ok(());
            };
            init::init_backfill(ctx, &access_token, scope, &link, &backfill_job).await
        }
        BackfillOperation::ListThreads(scope) => {
            let Some(JobContext {
                link,
                backfill_job,
                access_token,
            }) = fetch_job_context(ctx, scope).await?
            else {
                return Ok(());
            };
            list_threads::list_threads(ctx, &access_token, scope, &link, &backfill_job).await
        }
        BackfillOperation::BackfillThread(scope) => {
            let Some(JobContext {
                link, access_token, ..
            }) = fetch_job_context(ctx, scope).await?
            else {
                return Ok(());
            };
            backfill_thread::backfill_thread(ctx, &access_token, scope, &link).await
        }
        BackfillOperation::BackfillMessage(scope) => {
            let Some(JobContext {
                link, access_token, ..
            }) = fetch_job_context(ctx, scope).await?
            else {
                // BackfillMessage owns per-thread progress in addition to
                // the job-level progress that fetch_job_context already
                // cleared on cancellation. Drop it so a re-run of the
                // cancelled job doesn't see stale thread counters.
                let _ = ctx
                    .redis_client
                    .delete_backfill_thread_progress(
                        scope.job_id,
                        &scope.payload.thread_provider_id,
                    )
                    .await;
                return Ok(());
            };
            backfill_message::backfill_message(ctx, &access_token, scope, &link).await
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            // UpdateThreadMetadata is a DB-only step; skip the Gmail token
            // fetch so a revoked token can't fail this handler with
            // AccessTokenFetchFailed.
            let Some(JobContextNoToken { link, .. }) =
                fetch_job_context_no_token(ctx, scope).await?
            else {
                return Ok(());
            };
            update_metadata::update_thread_metadata(ctx, scope, &link).await
        }
        BackfillOperation::BackfillAttachment(scope) => {
            let Some(JobContext {
                link, access_token, ..
            }) = fetch_job_context(ctx, scope).await?
            else {
                return Ok(());
            };
            backfill_attachment::backfill_attachment(ctx, &access_token, &link, &scope.payload)
                .await
        }
        BackfillOperation::PopulateCrmContact(scope) => {
            let link = fetch_link(ctx, scope.link_id).await?;
            populate_crm_contact::populate_crm_contact(ctx, &link, &scope.payload).await
        }
        BackfillOperation::DepopulateCrmContact(scope) => {
            let link = fetch_link(ctx, scope.link_id).await?;
            depopulate_crm_contact::depopulate_crm_contact(ctx, &link, &scope.payload).await
        }
        BackfillOperation::PopulateCrmForUser(payload) => {
            populate_crm_for_user::populate_crm_for_user(ctx, payload).await
        }
        BackfillOperation::DepopulateCrmForUser(payload) => {
            depopulate_crm_for_user::depopulate_crm_for_user(ctx, payload).await
        }
    }
}

/// The pre-fetched context every job-scoped handler used to receive from
/// the top-level dispatcher: the link the operation targets, the backfill
/// job it belongs to, and a fresh Gmail access token for the link. Used by
/// handlers that talk to Gmail.
struct JobContext {
    link: link::Link,
    backfill_job: BackfillJob,
    access_token: String,
}

/// Same as [`JobContext`] but without a Gmail access token. Used by
/// handlers that only talk to the database (e.g. UpdateThreadMetadata) so
/// they don't fail with `AccessTokenFetchFailed` when a user's token is
/// revoked or temporarily unavailable.
struct JobContextNoToken {
    link: link::Link,
    backfill_job: BackfillJob,
}

/// Shared prefetch for DB-only job-scoped handlers: loads the backfill
/// job, short-circuits on cancellation (also cleaning up the job-level
/// redis progress key), and loads the link. Returns `Ok(None)` when the
/// parent backfill job has been cancelled — the caller should ack the
/// message without running the handler. Variant-specific cancellation
/// cleanup (e.g. per-thread progress keys) belongs at the call site, not
/// here.
async fn fetch_job_context_no_token<P>(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<P>,
) -> Result<Option<JobContextNoToken>, ProcessingError> {
    let backfill_job = email_db_client::backfill::job::get::get_backfill_job(&ctx.db, scope.job_id)
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
        let _ = ctx
            .redis_client
            .delete_backfill_job_progress(scope.job_id)
            .await;
        return Ok(None);
    }

    let link = fetch_link(ctx, scope.link_id).await?;

    Ok(Some(JobContextNoToken { link, backfill_job }))
}

/// As [`fetch_job_context_no_token`], plus a fresh Gmail access token for
/// the link. For handlers that need to talk to Gmail (Init, ListThreads,
/// BackfillThread, BackfillMessage, BackfillAttachment).
async fn fetch_job_context<P>(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<P>,
) -> Result<Option<JobContext>, ProcessingError> {
    let Some(JobContextNoToken { link, backfill_job }) =
        fetch_job_context_no_token(ctx, scope).await?
    else {
        return Ok(None);
    };

    let access_token = fetch_token_or_mark_reauth(
        &link,
        &ctx.db,
        &ctx.redis_client,
        &ctx.auth_service_client,
        &ctx.sqs_client,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::AccessTokenFetchFailed,
            source: e.context("Failed to fetch access token from link"),
        })
    })?;

    Ok(Some(JobContext {
        link,
        backfill_job,
        access_token,
    }))
}

/// Looks up a link by id, mapping the absence into a NonRetryable error
/// (the message names a link that doesn't exist; retrying won't help).
async fn fetch_link(ctx: &PubSubContext, link_id: Uuid) -> Result<link::Link, ProcessingError> {
    match email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        Ok(Some(link)) => Ok(link),
        Ok(None) => {
            let err_msg = format!("Link not found for link_id: {link_id}");
            tracing::error!("{}", err_msg);
            Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::LinkNotFound,
                source: anyhow::anyhow!(err_msg),
            }))
        }
        Err(e) => Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e,
        })),
    }
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
