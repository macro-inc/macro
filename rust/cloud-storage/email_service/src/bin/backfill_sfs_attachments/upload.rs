use anyhow::{Context, bail};
use models_email::service::attachment::{
    AttachmentSfs, AttachmentUploadArgs, AttachmentUploadDestination, AttachmentUploadMetadata,
};
use sqlx::PgPool;
use tracing::instrument;
use uuid::Uuid;

/// A helper struct to manage clients and tokens required for processing.
pub struct AttachmentProcessor {
    db: PgPool,
    sfs_client: static_file_service_client::StaticFileServiceClient,
    gmail_client: gmail_client::GmailClient,
    gmail_access_token: String,
    macro_id_destination: String,
}

impl AttachmentProcessor {
    pub fn new(
        db: PgPool,
        sfs_client: static_file_service_client::StaticFileServiceClient,
        gmail_client: gmail_client::GmailClient,
        gmail_access_token: String,
        macro_id_destination: String,
    ) -> Self {
        Self {
            db,
            sfs_client,
            gmail_client,
            gmail_access_token,
            macro_id_destination,
        }
    }

    /// Orchestrates the full upload process for a single attachment.
    #[instrument(skip(self), fields(file_name = %attachment.filename, mime_type = %attachment.mime_type))]
    pub async fn upload(&self, attachment: &AttachmentUploadMetadata) -> anyhow::Result<()> {
        let attachment_data = self
            .gmail_client
            .get_attachment_data(
                &self.gmail_access_token,
                &attachment.email_provider_id,
                &attachment.provider_attachment_id,
            )
            .await
            .context("Failed to get attachment data from Gmail")?;

        println!(
            "Successfully downloaded attachment data for {} ({} bytes)",
            attachment.filename,
            attachment_data.len()
        );

        let sfs_response = self
            .sfs_client
            .put_file_with_bytes(
                "a",
                bytes::Bytes::from(attachment_data),
                attachment.mime_type.clone(),
            )
            .await
            .context("Failed to upload attachment to SFS")?;

        // Store metadata in email_attachments_sfs table
        let attachment_sfs_id = macro_uuid::generate_uuid_v7();
        let sfs_id = Uuid::parse_str(&sfs_response.id).context("Failed to parse SFS ID as UUID")?;

        email_db_client::attachments::sfs::insert_attachment_sfs(
            &self.db,
            &AttachmentSfs {
                id: attachment_sfs_id,
                attachment_id: Some(attachment.attachment_db_id),
                sfs_id,
            },
        )
        .await
        .context("Failed to insert attachment SFS metadata")?;

        Ok(())
    }
}
