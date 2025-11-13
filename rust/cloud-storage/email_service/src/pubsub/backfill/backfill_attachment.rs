use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use anyhow::{Context, anyhow};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use model::chat::AttachmentMetadata;
use model::document::response::{CreateDocumentRequest, CreateDocumentResponse};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::backfill::{
    BackfillAttachmentPayload, BackfillMessagePayload, BackfillPubsubMessage,
};
use models_email::service::link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use reqwest::StatusCode;
use sha2::{Digest, Sha256};
use uuid::Uuid;
// --- Main Orchestrator Method ---

/// this step is invoked by the UpdateMetadata step. it uploads the specified attachment as a
/// Macro document for the user. first checks the attachment doesn't already exist by querying
/// document_email table before fetching and uploading the attachment data.
#[tracing::instrument(skip(ctx, access_token))]
pub async fn backfill_attachment(
    ctx: &PubSubContext,
    access_token: &str,
    link: &link::Link,
    p: &BackfillAttachmentPayload,
) -> Result<(), ProcessingError> {
    // 1. Check if a document for this attachment already exists.
    if attachment_document_exists(ctx, p.attachment_db_id).await? {
        tracing::debug!(
            "Macro document already exists for attachment {}, skipping upload",
            p.attachment_db_id
        );
        return Ok(());
    }

    // 2. Check rate limits before making a Gmail API call.
    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::MessagesAttachmentsGet,
        true,
    )
    .await?;

    // 3. Fetch the raw attachment data from Gmail.
    let attachment_data = fetch_gmail_attachment_data(ctx, access_token, p).await?;

    // 4. Calculate hashes required for the upload process.
    let (hex_hash, base64_hash) = calculate_hashes(&attachment_data);

    // 5. Determine file metadata from the payload.
    let (file_name, file_type) = determine_file_metadata(p)?;

    // 6. Create the document record in DSS and get a presigned URL for the upload.
    let dss_response =
        create_dss_document_record(ctx, link, p, &hex_hash, &file_name, &file_type).await?;

    // 7. Upload the attachment data to the presigned URL.
    upload_data_to_presigned_url(dss_response, attachment_data, &base64_hash).await?;

    Ok(())
}

// --- Helper Methods ---

/// Checks the database to see if a document has already been created for this attachment.
async fn attachment_document_exists(
    ctx: &PubSubContext,
    attachment_db_id: Uuid,
) -> Result<bool, ProcessingError> {
    email_db_client::attachments::provider::fetch_document_email_record(&ctx.db, attachment_db_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to query for document email record"),
            })
        })
}

/// Fetches the raw attachment data from the Gmail API.
async fn fetch_gmail_attachment_data(
    ctx: &PubSubContext,
    access_token: &str,
    p: &BackfillAttachmentPayload,
) -> Result<Vec<u8>, ProcessingError> {
    ctx.gmail_client
        .get_attachment_data(
            access_token,
            &p.email_provider_id,
            &p.provider_attachment_id,
        )
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to fetch attachment data from Gmail"),
            })
        })
}

/// Calculates the SHA256 hash of the attachment data in both hex and base64 formats.
fn calculate_hashes(data: &[u8]) -> (String, String) {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash_bytes = hasher.finalize();

    let hex_hash = format!("{:x}", hash_bytes);
    let base64_hash = STANDARD.encode(hash_bytes);

    (hex_hash, base64_hash)
}

/// Determines the file name (without extension) and file type (extension) from the payload.
fn determine_file_metadata(
    p: &BackfillAttachmentPayload,
) -> Result<(String, String), ProcessingError> {
    let file_name = p
        .filename
        .split('.')
        .next()
        .unwrap_or(&p.filename)
        .to_string();

    let file_type = mime_guess::get_mime_extensions_str(&p.mime_type)
        .and_then(|exts| exts.first().map(|s| s.to_string()))
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::AttachmentParsingFailed,
                source: anyhow!(
                    "Failed to determine file extension from mime type: {}",
                    p.mime_type
                ),
            })
        })?;

    Ok((file_name, file_type))
}

/// Creates a document record in the Document Storage Service (DSS) and returns the response,
/// which includes the presigned URL for the upload.
async fn create_dss_document_record(
    ctx: &PubSubContext,
    link: &link::Link,
    p: &BackfillAttachmentPayload,
    hex_hash: &str,
    file_name: &str,
    file_type: &str,
) -> Result<CreateDocumentResponse, ProcessingError> {
    let request = CreateDocumentRequest {
        id: None,
        sha: hex_hash.to_string(),
        document_name: file_name.to_string(),
        file_type: Some(file_type.to_string()),
        mime_type: Some(p.mime_type.clone()),
        document_family_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        job_id: None,
        project_id: None,
        created_at: Some(p.internal_date_ts),
        email_attachment_id: Some(p.attachment_db_id),
    };

    ctx.dss_client
        .create_document_internal(request, &link.macro_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DSSUploadFailed,
                source: e.context("Failed to create document record in DSS"),
            })
        })
}

/// Uploads the provided data to the presigned URL from the DSS response.
async fn upload_data_to_presigned_url(
    dss_response: CreateDocumentResponse,
    attachment_data: Vec<u8>,
    base64_hash: &str,
) -> Result<(), ProcessingError> {
    let presigned_url = dss_response
        .data
        .document_response
        .presigned_url
        .context("DSS response did not include a presigned URL")
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DSSUploadFailed,
                source: e,
            })
        })?;

    let response = reqwest::Client::new()
        .put(presigned_url)
        .header("content-type", dss_response.data.content_type)
        .header("x-amz-checksum-sha256", base64_hash)
        .body(attachment_data)
        .send()
        .await
        .context("HTTP PUT request to presigned URL failed")
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DSSUploadFailed,
                source: e,
            })
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DSSUploadFailed,
            source: anyhow!(
                "Failed to upload attachment to presigned url: {} {}",
                status,
                body
            ),
        }));
    }

    Ok(())
}
