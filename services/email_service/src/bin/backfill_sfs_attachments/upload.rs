use anyhow::Context;
use models_email::service::attachment::{AttachmentSfs, AttachmentUploadMetadata};
use sqlx::PgPool;
use static_file_service_client::put_file::PutFileResponse;
use tokio_retry::{Retry, strategy::ExponentialBackoff};
use tracing::instrument;
use uuid::Uuid;

/// A helper struct to manage clients and tokens required for processing.
pub struct AttachmentProcessor {
    db: PgPool,
    sfs_client: static_file_service_client::StaticFileServiceClient,
    gmail_client: gmail_client::GmailClient,
    gmail_access_token: String,
}

impl AttachmentProcessor {
    pub fn new(
        db: PgPool,
        sfs_client: static_file_service_client::StaticFileServiceClient,
        gmail_client: gmail_client::GmailClient,
        gmail_access_token: String,
    ) -> Self {
        Self {
            db,
            sfs_client,
            gmail_client,
            gmail_access_token,
        }
    }

    async fn download_attachment_bytes(
        &self,
        attachment: &AttachmentUploadMetadata,
    ) -> anyhow::Result<bytes::Bytes> {
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
            attachment.filename.clone().unwrap_or("N/A".to_string()),
            attachment_data.len()
        );

        Ok(bytes::Bytes::from(attachment_data))
    }

    // using retries because sfs intermittently fails by closing the connection
    async fn upload_to_sfs_with_retry(
        &self,
        bytes: bytes::Bytes,
        mime_type: String,
    ) -> anyhow::Result<PutFileResponse> {
        const MAX_ATTEMPTS: usize = 5;

        let retry_strategy = ExponentialBackoff::from_millis(2)
            .factor(100)
            .take(MAX_ATTEMPTS - 1);
        let mut attempt = 0usize;

        Retry::start(retry_strategy, || {
            attempt += 1;
            let bytes = bytes.clone();
            let mime_type = mime_type.clone();
            async move {
                match self
                    .sfs_client
                    .put_file_with_bytes("a", bytes, mime_type)
                    .await
                {
                    Ok(response) => Ok(response),
                    Err(error) => {
                        println!(
                            "SFS upload failed (attempt {attempt}/{MAX_ATTEMPTS}). Will{} retry. Error: {error:?}",
                            if attempt < MAX_ATTEMPTS { "" } else { " not" },
                        );
                        Err(anyhow::anyhow!("{error:?}").context(format!(
                            "Failed to upload attachment to SFS (attempt {attempt}/{MAX_ATTEMPTS})"
                        )))
                    }
                }
            }
        })
        .await
    }

    async fn persist_sfs_metadata(
        &self,
        attachment: &AttachmentUploadMetadata,
        sfs_id_str: &str,
    ) -> anyhow::Result<()> {
        let attachment_sfs_id = macro_uuid::generate_uuid_v7();
        let sfs_id = Uuid::parse_str(sfs_id_str).context("Failed to parse SFS ID as UUID")?;

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

    /// Orchestrates the full upload process for a single attachment.
    #[instrument(skip(self), fields(file_name = ?attachment.filename, mime_type = %attachment.mime_type))]
    pub async fn upload(&self, attachment: &AttachmentUploadMetadata) -> anyhow::Result<()> {
        let bytes = self.download_attachment_bytes(attachment).await?;

        let sfs_response = self
            .upload_to_sfs_with_retry(bytes, attachment.mime_type.clone())
            .await?;

        self.persist_sfs_metadata(attachment, &sfs_response.id)
            .await?;
        Ok(())
    }
}
