use crate::pubsub::backfill::increment_counters::{
    incr_completed_messages, incr_completed_threads,
};
use crate::pubsub::context::PubSubContext;
use models_email::email::service::backfill::{
    BackfillJobStatus, BackfillMessagePayload, BackfillOperation, BackfillPubsubMessage,
    JobScopedPayload,
};
use models_email::email::service::pubsub::DetailedError;
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
    tracing::error!(
        error = %e,
        source = { format!("{:#}", e.source) },
        "Non-retryable error processing message. The message will be deleted."
    );

    match &data.backfill_operation {
        BackfillOperation::Init(scope) => mark_job_failed(ctx, scope.job_id).await,
        BackfillOperation::ListThreads(scope) => mark_job_failed(ctx, scope.job_id).await,
        BackfillOperation::BackfillThread(scope) => {
            handle_thread_failure(ctx, scope.link_id, scope.job_id).await;
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            handle_thread_failure(ctx, scope.link_id, scope.job_id).await;
        }
        BackfillOperation::BackfillMessage(scope) => {
            handle_message_failure(ctx, scope).await;
        }
        BackfillOperation::BackfillAttachment(_) => {}
        BackfillOperation::PopulateCrmContact(_) => {}
        BackfillOperation::DepopulateCrmContact(_) => {}
        BackfillOperation::PopulateCrmForUser(_) => {}
        BackfillOperation::DepopulateCrmForUser(_) => {}
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

async fn mark_job_failed(ctx: &PubSubContext, job_id: Uuid) {
    if let Err(db_err) = email_db_client::backfill::job::update::update_backfill_job_status(
        &ctx.db,
        job_id,
        BackfillJobStatus::Failed,
    )
    .await
    {
        tracing::error!(
            error = %db_err,
            job_id = %job_id,
            "Failed to update backfill job status to Failed"
        );
    }
}

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument(
    skip(data, _e),
    fields(link_id = ?data.backfill_operation.link_id(), error = tracing::field::Empty)
)]
pub async fn handle_retryable_error(
    data: &BackfillPubsubMessage,
    _e: &DetailedError,
) -> anyhow::Result<()> {
    let error_chain = format!("{:#}", _e.source);
    tracing::Span::current().record("error", &error_chain);

    match &data.backfill_operation {
        BackfillOperation::Init(_) => {
            tracing::debug!("Retryable error in Init")
        }
        BackfillOperation::ListThreads(_) => {
            tracing::debug!("Retryable error listing threads")
        }
        BackfillOperation::BackfillThread(scope) => {
            tracing::debug!(
                thread_id = %scope.payload.thread_provider_id,
                "Retryable error backfilling thread"
            );
        }
        BackfillOperation::BackfillMessage(scope) => {
            tracing::debug!(
                thread_id = %scope.payload.thread_provider_id,
                message_id = %scope.payload.message_provider_id,
                "Retryable error backfilling message"
            );
        }
        BackfillOperation::UpdateThreadMetadata(scope) => {
            tracing::debug!(
                thread_id = %scope.payload.thread_provider_id,
                "Retryable error updating thread metadata"
            );
        }
        BackfillOperation::BackfillAttachment(scope) => {
            tracing::debug!(
                attachment_db_id = %scope.payload.metadata.attachment_metadata.attachment_db_id,
                "Retryable error backfilling attachment"
            )
        }
        BackfillOperation::PopulateCrmContact(scope) => {
            tracing::debug!(
                contact_email = %scope.payload.contact_email,
                "Retryable error populating CRM contact"
            )
        }
        BackfillOperation::DepopulateCrmContact(scope) => {
            tracing::debug!(
                contact_email = %scope.payload.contact_email,
                "Retryable error depopulating CRM contact"
            )
        }
        BackfillOperation::PopulateCrmForUser(payload) => {
            tracing::debug!(
                macro_id = %payload.macro_id,
                "Retryable error populating CRM for user"
            )
        }
        BackfillOperation::DepopulateCrmForUser(payload) => {
            tracing::debug!(
                macro_id = %payload.macro_id,
                "Retryable error depopulating CRM for user"
            )
        }
    }
    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_thread_failure(ctx: &PubSubContext, link_id: Uuid, job_id: Uuid) {
    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Link is gone — `incr_completed_threads` can't run without
            // it, so this thread will never complete on its own. Mark the
            // parent job failed instead of silently dropping the message
            // (the SQS message gets cleaned up after this returns, so a
            // silent return strands the job in InProgress forever).
            tracing::error!(
                link_id = link_id.to_string(),
                job_id = job_id.to_string(),
                "Link not found in handle_thread_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, job_id).await;
            return;
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                job_id = job_id.to_string(),
                "Failed to fetch link in handle_thread_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, job_id).await;
            return;
        }
    };

    if let Err(err) = incr_completed_threads(ctx, &link, job_id).await {
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
    scope: &JobScopedPayload<BackfillMessagePayload>,
) {
    let link = match email_db_client::links::get::fetch_link_by_id(&ctx.db, scope.link_id).await {
        Ok(Some(link)) => link,
        Ok(None) => {
            // Same defense as handle_thread_failure — without a link we
            // can't increment counters, and a silent return leaves the
            // parent job in InProgress forever after the SQS message is
            // cleaned up.
            tracing::error!(
                link_id = scope.link_id.to_string(),
                job_id = scope.job_id.to_string(),
                "Link not found in handle_message_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, scope.job_id).await;
            return;
        }
        Err(db_err) => {
            tracing::error!(
                error = %db_err,
                job_id = scope.job_id.to_string(),
                "Failed to fetch link in handle_message_failure; marking backfill job failed"
            );
            mark_job_failed(ctx, scope.job_id).await;
            return;
        }
    };

    if let Err(err) = incr_completed_messages(ctx, &link, scope.job_id, &scope.payload).await {
        tracing::error!(
            error = %err,
            job_id = scope.job_id.to_string(),
            "Failed to check if thread is completed in handle message failure"
        );
    }
}
