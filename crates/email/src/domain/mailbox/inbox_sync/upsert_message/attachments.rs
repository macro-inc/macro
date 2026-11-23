use super::*;
/// Uploads the message's new attachments, returning the rate limit that
/// refused an attachment fetch, if one did.
#[tracing::instrument(skip(ctx, attachments), err)]
pub(super) async fn handle_attachment_upload<L, R, G, Q, E>(
    ctx: &InboxSyncService<L, R, G, Q, E>,
    link: &link::Link,
    payload: &UpsertMessagePayload,
    attachments: &[Attachment],
) -> result::Result<Option<EmailApiError>, ProcessingError>
where
    L: GmailOpsLinks,
    R: InboxSyncImportRepository,
    G: InboxSyncImportGmail,
    Q: InboxSyncQueue,
    E: MacroEventBroker + InboxSyncRefresher + InboxSyncImportEffects,
{
    if !ctx.features.attachment_upload {
        return Ok(None);
    }

    // Keep this parsed-attachment gate at least as permissive as the database claim filters.
    let (documents, media) = ctx.effects.attachment_eligibility(attachments);
    if !documents && !media {
        return Ok(None);
    }

    // upload attachments to Macro
    let (document_atts, media_atts) = tokio::try_join!(
        async {
            if documents {
                ctx.repository
                    .document_attachments(link.id, &payload.provider_message_id)
                    .await
            } else {
                Ok(Vec::<AttachmentUploadMetadata>::new())
            }
        },
        async {
            if media {
                ctx.repository
                    .media_attachments(link.id, &payload.provider_message_id)
                    .await
            } else {
                Ok(Vec::<AttachmentUploadMetadata>::new())
            }
        }
    )
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e
                .into_original()
                .context("Failed to fetch attachments to insert".to_string()),
        })
    })?;

    let mut attachments = document_atts;
    attachments.extend(media_atts);
    if !attachments.is_empty() {
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
                    source: e.into_original().context(
                        "Failed to fetch db recipients for thread attachment backfill".to_string(),
                    ),
                })
            })?;

        let mut uploads = Vec::with_capacity(attachments.len());
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

            uploads.push(AttachmentUploadArgs {
                recipient_emails,
                attachment_metadata: attachment,
                backfill: false,
                upload_destination,
            });
        }

        return upload_claimed_attachments(&ctx.repository, uploads, |args| {
            ctx.effects.upload(link, args)
        })
        .await;
    }

    Ok(None)
}

/// Uploads claimed attachments in order. An attachment deleted mid-run is
/// skipped. Other upload failures are logged and skipped, but a fetch the
/// rate limit refused stops the run: the refused
/// attachment and the ones not yet tried lose their claims so a retry of the
/// upsert claims them again, and the refusal is returned.
pub async fn upload_claimed_attachments<R: InboxSyncImportRepository, F, Fut>(
    db: &R,
    uploads: Vec<AttachmentUploadArgs>,
    mut upload: F,
) -> result::Result<Option<EmailApiError>, ProcessingError>
where
    F: FnMut(AttachmentUploadArgs) -> Fut,
    Fut: Future<Output = result::Result<String, InboxSyncUploadError>>,
{
    let mut uploads = uploads.into_iter();
    while let Some(args) = uploads.next() {
        let attachment_id = args.attachment_metadata.attachment_db_id;
        match upload(args).await {
            Ok(_) => {}
            Err(InboxSyncUploadError::RateLimited(error)) => {
                let unfinished = std::iter::once(attachment_id)
                    .chain(uploads.map(|args| args.attachment_metadata.attachment_db_id));
                for attachment_id in unfinished {
                    db.release_attachment(attachment_id).await.map_err(|e| {
                        ProcessingError::Retryable(DetailedError {
                            reason: FailureReason::DatabaseQueryFailed,
                            source: e
                                .into_original()
                                .context("Failed to release attachment upload claim"),
                        })
                    })?;
                }
                return Ok(Some(error));
            }
            // A newer revision of the message carries its own attachment rows.
            Err(InboxSyncUploadError::AttachmentDeleted) => tracing::info!(
                %attachment_id,
                "skipped attachment deleted before it could be imported"
            ),
            // keep processing if it fails, best effort
            Err(e) => tracing::error!("Failed to upload attachment to Macro: {e}"),
        }
    }

    Ok(None)
}
