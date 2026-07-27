use crate::pubsub::crm_cleanup::worker::CrmCleanupContext;
use crate::pubsub::crm_cleanup::{list_candidates, process_candidate, start_job};
use anyhow::Context;
use models_email::email::service::crm_cleanup::{
    CrmCleanupJobStatus, CrmCleanupOperation, CrmCleanupPubsubMessage,
};
use models_email::email::service::pubsub::ProcessingError;
use sqs_worker::cleanup_message;

/// Process a single message from the crm cleanup queue.
pub async fn process_message(
    ctx: CrmCleanupContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    // Malformed JSON is NOT retryable.
    let data = match extract_cleanup_message(message) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract crm cleanup message, this is non-retryable.");
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

        // A permanent failure occurred. Clean up the message so it isn't retried;
        // a dead lister also fails its job so it doesn't dangle as active.
        Err(ProcessingError::NonRetryable(e)) => {
            tracing::error!(error = ?e, operation = ?data.operation, "Non-retryable crm cleanup error");
            if let CrmCleanupOperation::ListCandidates { job_id, .. } = &data.operation
                && let Err(status_err) = email_db_client::crm_cleanup::job::set_job_status(
                    &ctx.db,
                    *job_id,
                    CrmCleanupJobStatus::Failed,
                )
                .await
            {
                tracing::error!(error = ?status_err, job_id = %job_id, "Failed to mark crm cleanup job as failed");
            }
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }

        // A temporary failure occurred. Leave the message for SQS redelivery;
        // the queue's redrive policy dead-letters poison messages.
        Err(ProcessingError::Retryable(e)) => {
            tracing::warn!(error = ?e, operation = ?data.operation, "Retryable crm cleanup error; message will be redelivered");
            Ok(())
        }
    }
}

#[tracing::instrument(skip(ctx))]
async fn inner_process_message(
    ctx: &CrmCleanupContext,
    data: &CrmCleanupPubsubMessage,
) -> Result<(), ProcessingError> {
    match &data.operation {
        CrmCleanupOperation::StartJob => start_job::start_job(ctx).await,
        CrmCleanupOperation::ListCandidates { job_id, last_id } => {
            list_candidates::list_candidates(ctx, *job_id, *last_id).await
        }
        CrmCleanupOperation::ProcessCandidate {
            link_id,
            contact_email,
        } => process_candidate::process_candidate(ctx, *link_id, contact_email).await,
    }
}

/// Extracts the crm cleanup message from the SQS message body
#[tracing::instrument(skip(message))]
fn extract_cleanup_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<CrmCleanupPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    let cleanup_message: CrmCleanupPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to CrmCleanupPubsubMessage")?;

    Ok(cleanup_message)
}
