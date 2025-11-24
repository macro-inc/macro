use anyhow::{Context, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use model::document::response::CreateDocumentRequest;
use models_email::service::attachment::AttachmentUploadMetadata;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tracing::instrument;
use uuid::Uuid;

/// A helper struct to manage clients and tokens required for processing.
pub struct AttachmentProcessor {
    db: PgPool,
    dss_client: document_storage_service_client::DocumentStorageServiceClient,
    gmail_client: gmail_client::GmailClient,
    gmail_access_token: String,
    macro_id_destination: String,
}

impl AttachmentProcessor {
    pub fn new(
        db: PgPool,
        dss_client: document_storage_service_client::DocumentStorageServiceClient,
        gmail_client: gmail_client::GmailClient,
        gmail_access_token: String,
        macro_id_destination: String,
    ) -> Self {
        Self {
            db,
            dss_client,
            gmail_client,
            gmail_access_token,
            macro_id_destination,
        }
    }

    /// Orchestrates the full upload process for a single attachment.
    #[instrument(skip(self), fields(file_name = %attachment.filename, mime_type = %attachment.mime_type))]
    pub async fn upload(
        &self,
        link_id: Uuid,
        attachment: &AttachmentUploadMetadata,
    ) -> anyhow::Result<()> {
        let exists = email_db_client::attachments::provider::get_document_id_by_attachment_id(
            &self.db,
            link_id,
            attachment.attachment_db_id,
        )
        .await?
        .is_some();
        if exists {
            println!(
                "Attachment {} already exists in DSS, skipping",
                attachment.attachment_db_id
            );
            return Ok(());
        }

        // 1. Fetch attachment data from Gmail.
        let data = self.fetch_gmail_data(attachment).await?;

        // 2. Calculate hashes required for validation.
        let (sha256_hex, sha256_base64) = Self::calculate_hashes(&data);

        // 3. Get a presigned URL from the Document Storage Service.
        let (presigned_url, content_type) = self.get_presigned_url(attachment, &sha256_hex).await?;

        // 4. Upload the data to the presigned URL (e.g., S3).
        self.upload_to_storage(&presigned_url, &content_type, &sha256_base64, data)
            .await?;

        Ok(())
    }

    /// Fetches the raw attachment data from the Gmail API.
    async fn fetch_gmail_data(
        &self,
        attachment: &AttachmentUploadMetadata,
    ) -> anyhow::Result<Vec<u8>> {
        self.gmail_client
            .get_attachment_data(
                &self.gmail_access_token,
                &attachment.email_provider_id,
                &attachment.provider_attachment_id,
            )
            .await
            .context("Failed to get attachment data from Gmail")
    }

    /// Calculates the hex and base64 encoded SHA256 hash of the attachment data.
    fn calculate_hashes(data: &[u8]) -> (String, String) {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash_bytes = hasher.finalize();

        let hex_hash = format!("{:x}", hash_bytes);
        let base64_hash = STANDARD.encode(hash_bytes);

        (hex_hash, base64_hash)
    }

    /// Requests a pre-signed upload URL from the Document Storage Service.
    async fn get_presigned_url(
        &self,
        attachment: &AttachmentUploadMetadata,
        sha256_hex: &str,
    ) -> anyhow::Result<(String, String)> {
        let file_name = attachment
            .filename
            .split('.')
            .next()
            .unwrap_or(&attachment.filename)
            .to_string();

        let file_type = mime_guess::get_mime_extensions_str(&attachment.mime_type)
            .and_then(|exts| exts.first().map(|s| s.to_string()))
            .context("Could not determine file extension from MIME type")?;

        let dss_response = self
            .dss_client
            .create_document_internal(
                CreateDocumentRequest {
                    id: None,
                    sha: sha256_hex.to_string(),
                    document_name: file_name,
                    file_type: Some(file_type),
                    mime_type: Some(attachment.mime_type.clone()),
                    document_family_id: None,
                    branched_from_id: None,
                    branched_from_version_id: None,
                    job_id: None,
                    project_id: None,
                    created_at: Some(attachment.internal_date_ts),
                    email_attachment_id: Some(attachment.attachment_db_id),
                },
                &self.macro_id_destination,
            )
            .await
            .context("DSS create_document call failed")?;

        let presigned_url = dss_response
            .data
            .document_response
            .presigned_url
            .context("DSS response did not include a presigned URL")?;

        Ok((presigned_url, dss_response.data.content_type))
    }

    /// Performs the final PUT request to upload the file data to cloud storage.
    async fn upload_to_storage(
        &self,
        url: &str,
        content_type: &str,
        sha256_base64: &str,
        data: Vec<u8>,
    ) -> anyhow::Result<()> {
        let response = reqwest::Client::new()
            .put(url)
            .header("content-type", content_type)
            .header("x-amz-checksum-sha256", sha256_base64)
            .body(data)
            .send()
            .await
            .context("HTTP request to presigned URL failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!(
                "Upload to storage failed with status {}. Body: {}",
                status,
                body
            );
        }

        Ok(())
    }
}
