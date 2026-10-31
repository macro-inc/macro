//! Load attachment metadata once and assemble exactly that payload before sending.

use anyhow::Context;
use email::domain::attachment_access::AuthorizedAttachmentBytes;
use email::domain::scheduled_delivery::attachments::{
    ApprovedAttachments, AttachmentSnapshotMismatch,
};
use futures::{StreamExt, TryStreamExt};
use models_email::service::{
    attachment::{AttachmentDraft, AttachmentToSend},
    message::MessageToSend,
};
use sqlx::PgPool;
use uuid::Uuid;

/// Assemble attachments from one validated metadata snapshot. No provider send
/// occurs here, so every error leaves delivery safe to cancel or retry.
#[tracing::instrument(skip_all, fields(message_id = ?message.db_id), err)]
pub async fn prepare_delivery_attachments(
    db: &PgPool,
    s3_client: &s3_client::S3,
    reader: &dyn AuthorizedAttachmentBytes,
    actor: &str,
    bucket: &str,
    message: &mut MessageToSend,
    approved: Option<&ApprovedAttachments>,
) -> anyhow::Result<Option<Vec<AttachmentDraft>>> {
    let message_id = message
        .db_id
        .context("delivery message has no database identity")?;
    let snapshot = AttachmentMetadata::load(db, message.link_id, message_id, approved).await?;

    anyhow::ensure!(
        snapshot.uploaded.iter().all(|file| !file.upload_pending),
        AttachmentSnapshotMismatch
    );
    let uploaded = snapshot.uploaded.iter().map(|attachment| async move {
        let data = s3_client
            .get(bucket, &attachment.s3_key)
            .await
            .map_err(classify_uploaded_attachment_error)
            .context("failed to load an approved uploaded attachment")?;
        Ok::<_, anyhow::Error>(AttachmentToSend {
            content_id: attachment.content_id.clone(),
            is_inline: attachment.is_inline,
            file_name: attachment.file_name.clone(),
            content_type: attachment.content_type.clone(),
            data,
        })
    });
    let forwarded = prepare_provider_attachments(
        reader,
        actor,
        &snapshot.forwarded,
        message.body_html.as_deref(),
    );
    let (mut uploaded_bytes, forwarded_bytes) =
        tokio::try_join!(futures::future::try_join_all(uploaded), forwarded,)?;
    uploaded_bytes.extend(forwarded_bytes);
    anyhow::ensure!(
        uploaded_bytes
            .iter()
            .map(|file| file.data.len())
            .sum::<usize>()
            <= 18_000_000,
        AttachmentSnapshotMismatch
    );
    message.attachments = (!uploaded_bytes.is_empty()).then_some(uploaded_bytes);
    Ok((!snapshot.uploaded.is_empty()).then_some(snapshot.uploaded))
}

async fn prepare_provider_attachments(
    reader: &dyn AuthorizedAttachmentBytes,
    actor: &str,
    attachment_ids: &[Uuid],
    html: Option<&str>,
) -> anyhow::Result<Vec<AttachmentToSend>> {
    let forwarded = attachment_ids.iter().copied().map(|id| async move {
        let (record, data) = reader
            .read(actor, id)
            .await
            .map_err(|error| match error {
                email::domain::mailbox::MailboxError::Provider(
                    email_api_client::domain::models::EmailApiError::NotFound
                    | email_api_client::domain::models::EmailApiError::Forbidden
                    | email_api_client::domain::models::EmailApiError::AuthRequired,
                ) => anyhow::Error::new(AttachmentSnapshotMismatch),
                other => anyhow::Error::new(other),
            })
            .context("failed to load an approved provider attachment")?;
        let attachment = record.attachment;
        let content_id = attachment
            .content_id
            .map(|id| id.trim_matches(['<', '>']).to_owned());
        let is_inline = content_id
            .as_deref()
            .is_some_and(|id| html.is_some_and(|body| body.contains(&format!("cid:{id}"))));
        Ok::<_, anyhow::Error>(AttachmentToSend {
            content_id,
            is_inline,
            file_name: attachment.filename.unwrap_or_else(|| "attachment".into()),
            content_type: attachment
                .mime_type
                .unwrap_or_else(|| "application/octet-stream".into()),
            data,
        })
    });
    futures::stream::iter(forwarded)
        .buffered(4)
        .try_collect()
        .await
}

fn classify_uploaded_attachment_error(error: anyhow::Error) -> anyhow::Error {
    let missing = error.chain().any(|cause| {
        cause
            .downcast_ref::<aws_sdk_s3::operation::get_object::GetObjectError>()
            .is_some_and(|error| error.is_no_such_key())
    });
    if missing {
        error.context(AttachmentSnapshotMismatch)
    } else {
        error
    }
}

/// Approved identities remain available if sources disappear while bytes are loaded.
struct AttachmentMetadata {
    uploaded: Vec<AttachmentDraft>,
    forwarded: Vec<Uuid>,
}

impl AttachmentMetadata {
    async fn load(
        db: &PgPool,
        link_id: Uuid,
        message_id: Uuid,
        approved: Option<&ApprovedAttachments>,
    ) -> anyhow::Result<Self> {
        let (uploaded, forwarded) = tokio::try_join!(
            email_db_client::attachments::draft::fetch_draft_attachments_by_draft_id(
                db, link_id, message_id,
            ),
            async {
                sqlx::query_scalar!("SELECT attachment_id AS \"attachment_id!\" FROM email_draft_provider_attachment_ids($1, $2) ORDER BY attachment_id", message_id, link_id).fetch_all(db).await.map_err(anyhow::Error::from)
            },
        )?;
        if let Some(approved) = approved {
            approved.validate(
                &uploaded
                    .iter()
                    .map(|attachment| attachment.id)
                    .collect::<Vec<_>>(),
                &forwarded,
            )?;
        }
        Ok(Self {
            uploaded,
            forwarded,
        })
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod provider_test;
