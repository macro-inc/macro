use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use crate::domain::mailbox::inbox_sync::build_contact_connections;
use models_email::service::{
    backfill::*,
    link::Link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
use models_email::{
    db::address::EmailRecipientType,
    service::attachment::{
        AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
    },
};
use uuid::Uuid;
#[tracing::instrument(skip(ctx))]
pub(super) async fn handle_attachment_upload<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    if !ctx.attachment_upload {
        return Ok(());
    }

    let attachments = ctx.repository.job_attachments(link.id).await.map_err(|e| {
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
pub(super) async fn handle_contacts_sync<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    if !ctx.contacts_sync {
        return Ok(());
    }

    let email_addresses = ctx.repository.contact_emails(link.id).await.map_err(|e| {
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

    let connections = build_contact_connections(
        &link.macro_id,
        link.id,
        email_addresses.iter().map(String::as_str),
    );

    ctx.effects
        .connect_contacts(&link.macro_id, connections)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: anyhow::anyhow!("{e:?}").context(format!(
                    "Failed to enqueue {length} contact connections for link {}",
                    link.id
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
pub(super) async fn handle_thread_completed<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
    p: &BackfillMessagePayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    enqueue_thread_metadata_update(ctx, link, job_id, &p.thread_provider_id, p.thread_db_id)
        .await?;
    handle_thread_attachment_upload(ctx, link, job_id, p.thread_db_id).await
}

/// Hands a fully written thread to its UpdateThreadMetadata step, which
/// computes the thread's metadata and counts it as completed.
#[tracing::instrument(skip(ctx))]
pub(super) async fn enqueue_thread_metadata_update<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
    thread_provider_id: &str,
    thread_db_id: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    let ps_message = BackfillPubsubMessage {
        backfill_operation: BackfillOperation::UpdateThreadMetadata(JobScopedPayload {
            link_id: link.id,
            job_id,
            payload: UpdateMetadataPayload {
                thread_provider_id: thread_provider_id.to_string(),
                thread_db_id,
            },
        }),
    };

    ctx.queue.enqueue(ps_message).await.map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: e
                .into_original()
                .context("Failed to enqueue metadata message".to_string()),
        })
    })
}

/// Creates BackfillAttachmentPayload messages and enqueues them via SQS for the given attachments
#[tracing::instrument(skip(ctx, attachments))]
async fn send_attachment_backfill_messages<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link_id: Uuid,
    job_id: Uuid,
    attachments: Vec<AttachmentUploadMetadata>,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    if attachments.is_empty() {
        return Ok(());
    }

    let message_ids = attachments
        .iter()
        .map(|a| a.message_db_id)
        .collect::<Vec<_>>();

    let message_recipients = ctx
        .repository
        .attachment_recipients(&message_ids)
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

        ctx.queue.enqueue(ps_message).await.map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::SqsEnqueueFailed,
                source: e
                    .into_original()
                    .context("Failed to enqueue attachment backfill message".to_string()),
            })
        })?;
    }

    Ok(())
}

/// Enqueues the uploads of a backfilled thread's attachments.
#[tracing::instrument(skip(ctx))]
pub(super) async fn handle_thread_attachment_upload<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
    thread_db_id: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    if !ctx.attachment_upload {
        return Ok(());
    }

    let (attachments, attachments2) = ctx
        .repository
        .thread_attachments(thread_db_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .context("Failed to fetch thread attachment backfill metadata".to_string()),
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
