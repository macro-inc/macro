use std::collections::HashSet;

use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::cg_refresh_email;
use contacts::domain::ports::ContactsIngress;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::api::refresh::{BackfillStatus, RefreshEmailEvent};
use models_email::db::address::EmailRecipientType;
use models_email::service::attachment::{
    AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
};
use models_email::service::backfill::{
    BackfillAttachmentPayload, BackfillJobStatus, BackfillMessagePayload, BackfillOperation,
    BackfillPubsubMessage, JobScopedPayload, UpdateMetadataPayload,
};
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

/// Emit a `refresh_email` event once per this many completed threads, plus
/// once at job completion, rather than per-thread.
const REFRESH_EMAIL_THREAD_INTERVAL: i32 = 50;

/// called when a thread has completed processing. checks if it is the last thread to be processed
/// for the job, and if so, performs the necessary actions for job completion.
#[tracing::instrument(skip(ctx))]
pub async fn incr_completed_threads(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    let progress = ctx
        .redis_client
        .incr_completed_threads(job_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::RedisQueryFailed,
                source: e.context("Failed to increment completed thread count"),
            })
        })?;

    if progress.job_complete || progress.completed_threads % REFRESH_EMAIL_THREAD_INTERVAL == 0 {
        cg_refresh_email(
            &ctx.connection_gateway_client,
            link.macro_id.as_ref(),
            RefreshEmailEvent::Backfill {
                link_id: link.id,
                status: if progress.job_complete {
                    BackfillStatus::Complete
                } else {
                    BackfillStatus::Progress
                },
            },
        )
        .await;
    }

    if progress.job_complete {
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
pub(super) async fn handle_job_completed(
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

    handle_attachment_upload(ctx, link, job_id).await?;
    handle_contacts_sync(ctx, link).await?;

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_attachment_upload(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "attachment_upload")) {
        return Ok(());
    }

    let attachments =
        email_db_client::attachments::provider::upload::fetch_job_attachments_for_backfill(
            &ctx.db, link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch job attachment backfill metadata".to_string()),
            })
        })?;

    if !attachments.is_empty() {
        tracing::debug!(
            "Found {} condition 5 attachments to backfill for job {}",
            attachments.len(),
            job_id
        );

        send_attachment_backfill_messages(ctx, link.id, job_id, attachments).await?;
    }

    Ok(())
}

#[tracing::instrument(skip(ctx))]
async fn handle_contacts_sync(ctx: &PubSubContext, link: &Link) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "contacts_sync")) {
        return Ok(());
    }

    let email_addresses =
        email_db_client::contacts::get::fetch_contacts_emails_by_link_id(&ctx.db, link.id)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to fetch contact email addresses".to_string()),
                })
            })?;

    let length = email_addresses.len();

    tracing::info!(
        "Populating {} contacts for macro email {}",
        length,
        link.macro_id
    );

    let users: HashSet<MacroUserIdStr<'static>> = std::iter::once(Ok(link.macro_id.clone()))
        .chain(
            email_addresses
                .iter()
                .map(|email| MacroUserIdStr::try_from_email(email)),
        )
        .collect::<Result<_, _>>()
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: anyhow::anyhow!(e).context("invalid user email for contacts"),
            })
        })?;

    ctx.contacts_ingress
        .enqueue_contacts(users)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: anyhow::anyhow!("{e:?}").context(format!(
                    "Failed to enqueue contacts message for {}",
                    email_addresses.join(", ")
                )),
            })
        })?;

    tracing::info!(
        "Successfully populated {} contacts for macro email {}",
        length,
        link.macro_id
    );

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
        backfill_operation: BackfillOperation::UpdateThreadMetadata(JobScopedPayload {
            link_id: link.id,
            job_id,
            payload: new_payload,
        }),
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

    handle_thread_attachment_upload(ctx, link, job_id, p.thread_db_id).await?;

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
    if attachments.is_empty() {
        return Ok(());
    }

    let message_ids = attachments
        .iter()
        .map(|a| a.message_db_id)
        .collect::<Vec<_>>();

    let message_recipients =
        email_db_client::contacts::get::fetch_db_recipients_in_bulk(&ctx.db, &message_ids)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context(
                        "Failed to fetch db recipients for thread attachment backfill".to_string(),
                    ),
                })
            })?;

    for attachment in attachments {
        // get the email addresses of the recipients of the message
        let recipient_emails: Vec<String> = message_recipients
            .get(&attachment.message_db_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|(_, recipient_type)| *recipient_type == EmailRecipientType::To)
            .filter_map(|(contact, _)| contact.email_address.clone())
            .collect();

        let upload_destination = if matches!(
            attachment.mime_type.split('/').next(),
            Some("image" | "video")
        ) {
            AttachmentUploadDestination::Sfs
        } else {
            AttachmentUploadDestination::Dss
        };

        let attachment_upload_args = AttachmentUploadArgs {
            recipient_emails,
            attachment_metadata: attachment,
            backfill: true,
            upload_destination,
        };

        let new_payload = BackfillAttachmentPayload {
            metadata: attachment_upload_args,
        };

        let ps_message = BackfillPubsubMessage {
            backfill_operation: BackfillOperation::BackfillAttachment(JobScopedPayload {
                link_id,
                job_id,
                payload: new_payload,
            }),
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

#[tracing::instrument(skip(ctx))]
async fn handle_thread_attachment_upload(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    thread_db_id: Uuid,
) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "attachment_upload")) {
        return Ok(());
    }

    let (attachments, attachments2) = tokio::try_join!(
        email_db_client::attachments::provider::upload::thread_document_atts_for_backfill(
            &ctx.db,
            thread_db_id,
        ),
        email_db_client::attachments::provider::upload::thread_media_atts_for_backfill(
            &ctx.db,
            thread_db_id,
        )
    )
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch thread attachment backfill metadata".to_string()),
        })
    })?;

    let mut all_attachments = attachments;
    all_attachments.extend(attachments2);

    if !all_attachments.is_empty() {
        tracing::debug!(
            "Found {} attachments to backfill for thread {}",
            all_attachments.len(),
            thread_db_id
        );

        send_attachment_backfill_messages(ctx, link.id, job_id, all_attachments).await?;
    }

    Ok(())
}
