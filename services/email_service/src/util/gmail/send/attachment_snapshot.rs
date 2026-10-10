//! Load attachment metadata once and assemble exactly that payload before sending.

use crate::outbound::email_api::GmailApi;
use anyhow::Context;
use email::domain::scheduled_delivery::attachments::{
    ApprovedAttachments, AttachmentSnapshotMismatch,
};
use models_email::service::{
    attachment::{AttachmentDraft, AttachmentForwarded, AttachmentToSend},
    link::Link,
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
    email_api: &GmailApi,
    bucket: &str,
    link: &Link,
    message: &mut MessageToSend,
    approved: Option<&ApprovedAttachments>,
) -> anyhow::Result<Option<Vec<AttachmentDraft>>> {
    let message_id = message
        .db_id
        .context("delivery message has no database identity")?;
    let snapshot = AttachmentMetadata::load(db, link.id, message_id, approved).await?;

    let uploaded = snapshot.uploaded.iter().map(|attachment| async move {
        let data = s3_client
            .get(bucket, &attachment.s3_key)
            .await
            .map_err(classify_uploaded_attachment_error)
            .context("failed to load an approved uploaded attachment")?;
        Ok::<_, anyhow::Error>(AttachmentToSend {
            file_name: attachment.file_name.clone(),
            content_type: attachment.content_type.clone(),
            data,
        })
    });
    let forwarded = snapshot.forwarded.iter().map(|attachment| async move {
        let data = email_api
            .get_attachment(
                link.id,
                &attachment.message_provider_id,
                attachment
                    .provider_attachment_id
                    .as_deref()
                    .unwrap_or_default(),
            )
            .await
            .context("failed to load an approved forwarded attachment")?;
        Ok::<_, anyhow::Error>(AttachmentToSend {
            file_name: attachment.filename.clone().unwrap_or_default(),
            content_type: attachment
                .mime_type
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string()),
            data,
        })
    });
    let (mut uploaded_bytes, forwarded_bytes) = tokio::try_join!(
        futures::future::try_join_all(uploaded),
        futures::future::try_join_all(forwarded),
    )?;
    uploaded_bytes.extend(forwarded_bytes);
    message.attachments = (!uploaded_bytes.is_empty()).then_some(uploaded_bytes);
    Ok((!snapshot.uploaded.is_empty()).then_some(snapshot.uploaded))
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

/// Metadata remains available if source rows disappear while bytes are loaded.
struct AttachmentMetadata {
    uploaded: Vec<AttachmentDraft>,
    forwarded: Vec<AttachmentForwarded>,
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
            email_db_client::attachments::forwarded::fetch_forwarded_attachments_by_draft_id(
                db, link_id, message_id,
            ),
        )?;
        if let Some(approved) = approved {
            approved.validate(
                &uploaded
                    .iter()
                    .map(|attachment| attachment.id)
                    .collect::<Vec<_>>(),
                &forwarded
                    .iter()
                    .map(|attachment| attachment.attachment_id)
                    .collect::<Vec<_>>(),
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
