use crate::pubsub::context::PubSubContext;
use crate::util::backfill::backfill_insights::backfill_email_insights;
use model::contacts::ConnectionsMessage;
use model::insight_context::email_insights::BackfillEmailInsightsFilter;
use models_email::service::attachment::AttachmentUploadMetadata;
use models_email::service::backfill::{
    BackfillAttachmentPayload, BackfillJobStatus, BackfillMessagePayload, BackfillOperation,
    BackfillPubsubMessage, UpdateMetadataPayload,
};
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

/// called when a thread has completed processing. checks if it is the last thread to be processed
/// for the job, and if so, performs the necessary actions for job completion.
#[tracing::instrument(skip(ctx))]
pub async fn incr_completed_threads(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    let all_threads_processed = ctx
        .redis_client
        .incr_completed_threads(job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context("Failed to increment completed thread count"),
            })
        })?;

    if all_threads_processed {
        tracing::info!(
            job_id = job_id.to_string(),
            "All threads for job have been processed"
        );
        handle_job_completed(ctx, link, job_id).await?;
    }

    Ok(())
}

/// If this message was the last one in the thread to be processed, proceed to next stage of backfill for thread
#[tracing::instrument(skip(ctx))]
pub async fn incr_completed_messages(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    let thread_backfill_complete = ctx
        .redis_client
        .incr_completed_messages(job_id, &p.thread_provider_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context(format!(
                    "Handle completed message for {} failed",
                    p.message_provider_id
                )),
            })
        })?;

    if thread_backfill_complete {
        handle_thread_completed(ctx, link, job_id, p).await?;
    }

    Ok(())
}

/// performs actions when all threads and messages have been backfilled for the user.
#[tracing::instrument(skip(ctx))]
async fn handle_job_completed(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    tracing::info!("Backfill complete for job {}", job_id);
    email_db_client::backfill::job::update::update_backfill_job_status(
        &ctx.db,
        job_id,
        BackfillJobStatus::Complete,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to update thread status to complete"),
        })
    })?;

    tracing::info!("Backfilling email insights for user {}", link.macro_id);
    let backfill_email_insights_filter = BackfillEmailInsightsFilter {
        user_ids: Some(vec![link.macro_id.to_string()]),
        user_thread_limit: None,
    };

    backfill_email_insights(
        ctx.sqs_client.clone(),
        &ctx.db,
        backfill_email_insights_filter,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to backfill email insights"),
        })
    })?;

    // temporarily only enabling for macro emails for testing
    if link.macro_id.ends_with("@macro.com") && !cfg!(feature = "disable_attachment_upload") {
        let attachments =
            email_db_client::attachments::provider::upload::fetch_job_attachments_for_backfill(
                &ctx.db, link.id,
            )
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e
                        .context("Failed to fetch job attachment backfill metadata".to_string()),
                })
            })?;

        tracing::info!(
            "Found {} condition 5 attachments to backfill for job {}",
            attachments.len(),
            job_id
        );

        send_attachment_backfill_messages(ctx, link.id, job_id, attachments).await?;
    }

    // temporarily only populate contacts for macro emails for testing
    if link.macro_id.ends_with("@macro.com") && !cfg!(feature = "disable_contacts_sync") {
        let email_addresses =
            email_db_client::contacts::get::fetch_contacts_emails_by_link_id(&ctx.db, link.id)
                .await
                .map_err(|e| {
                    ProcessingError::NonRetryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to fetch contact email addresses".to_string()),
                    })
                })?;

        tracing::info!(
            "Populating {} contacts for macro email {}",
            email_addresses.len(),
            link.macro_id
        );

        for email_address in email_addresses {
            let connections_message = ConnectionsMessage {
                users: vec![link.macro_id.clone(), format!("macro|{}", email_address)],
                connections: vec![(0, 1)],
            };
            ctx.sqs_client
                .enqueue_contacts_add_connection(connections_message)
                .await
                .map_err(|e| {
                    ProcessingError::NonRetryable(DetailedError {
                        reason: FailureReason::SqsEnqueueFailed,
                        source: e.context(format!(
                            "Failed to enqueue contacts message for {}",
                            email_address
                        )),
                    })
                })?;
        }
        tracing::info!(
            "Successfully populated {} contacts for macro email {}",
            email_addresses.len(),
            link.macro_id
        );
    }

    Ok(())
}

/// when a thread is done being backfilled, update its metadata and backfill its attachments.
#[tracing::instrument(skip(ctx))]
async fn handle_thread_completed(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    let new_payload = UpdateMetadataPayload {
        thread_provider_id: p.thread_provider_id.clone(),
        thread_db_id: p.thread_db_id,
    };

    let ps_message = BackfillPubsubMessage {
        link_id: link.id,
        job_id,
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

    // temporarily only for macro emails, for testing
    if link.macro_id.ends_with("@macro.com") && !cfg!(feature = "disable_attachment_upload") {
        let attachments =
            email_db_client::attachments::provider::upload::fetch_thread_attachments_for_backfill(
                &ctx.db,
                p.thread_db_id,
            )
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e
                        .context("Failed to fetch thread attachment backfill metadata".to_string()),
                })
            })?;
        if !attachments.is_empty() {
            tracing::info!(
                "Found {} attachments to backfill for thread {}",
                attachments.len(),
                p.thread_db_id
            );
        }

        send_attachment_backfill_messages(ctx, link.id, job_id, attachments).await?;
    }

    Ok(())
}

/// Creates BackfillAttachmentPayload messages and enqueues them via SQS for the given attachments
#[tracing::instrument(skip(ctx, attachments))]
async fn send_attachment_backfill_messages(
    ctx: &PubSubContext,
    link_id: Uuid,
    job_id: Uuid,
    attachments: Vec<AttachmentUploadMetadata>,
) -> Result<(), ProcessingError> {
    for attachment in attachments {
        let new_payload = BackfillAttachmentPayload {
            metadata: AttachmentUploadMetadata {
                attachment_db_id: attachment.attachment_db_id,
                email_provider_id: attachment.email_provider_id,
                provider_attachment_id: attachment.provider_attachment_id,
                mime_type: attachment.mime_type,
                filename: attachment.filename,
                internal_date_ts: attachment.internal_date_ts,
            },
        };

        let ps_message = BackfillPubsubMessage {
            link_id,
            job_id,
            backfill_operation: BackfillOperation::BackfillAttachment(new_payload),
        };

        ctx.sqs_client
            .enqueue_email_backfill_message(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue attachment backfill message".to_string()),
                })
            })?;
    }

    Ok(())
}
