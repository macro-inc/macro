use crate::pubsub::util::check_gmail_rate_limit;
use crate::util::redis::RedisClient;
use anyhow::{Context, anyhow};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use document_storage_service_client::DocumentStorageServiceClient;
use gmail_client::GmailClient;
use model::document::response::{CreateDocumentRequest, CreateDocumentResponse};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::attachment::AttachmentUploadMetadata;
use models_email::service::link;
use sha2::{Digest, Sha256};

/// Upload an email attachment to DSS as a document.
#[tracing::instrument(skip(redis_client, gmail_client, dss_client, access_token), err)]
pub async fn upload_attachment(
    redis_client: &RedisClient,
    gmail_client: &GmailClient,
    dss_client: &DocumentStorageServiceClient,
    access_token: &str,
    link: &link::Link,
    p: &AttachmentUploadMetadata,
) -> anyhow::Result<String> {
    // 1. Check rate limits before making a Gmail API call.
    check_gmail_rate_limit(
        redis_client,
        link.id,
        GmailApiOperation::MessagesAttachmentsGet,
        true,
    )
    .await
    .context("Rate limit check failed")?;

    // 2. Fetch the raw attachment data from Gmail.
    let attachment_data = fetch_gmail_attachment_data(gmail_client, access_token, p).await?;

    // 3. Calculate hashes required for the upload process.
    let (hex_hash, base64_hash) = calculate_hashes(&attachment_data);

    // 4. Determine file metadata from the payload.
    let (file_name, file_type) = determine_file_metadata(p)?;

    // 5. Create the document record in DSS and get a presigned URL for the upload.
    let dss_response =
        create_dss_document_record(dss_client, link, p, &hex_hash, &file_name, &file_type).await?;

    // 6. Upload the attachment data to the presigned URL.
    upload_data_to_presigned_url(&dss_response, attachment_data, &base64_hash).await?;

    // 7. Return document id to caller
    let document_id = dss_response
        .data
        .document_response
        .document_metadata
        .document_id;

    Ok(document_id)
}

/// Fetches the raw attachment data from the Gmail API.
async fn fetch_gmail_attachment_data(
    gmail_client: &GmailClient,
    access_token: &str,
    p: &AttachmentUploadMetadata,
) -> anyhow::Result<Vec<u8>> {
    gmail_client
        .get_attachment_data(
            access_token,
            &p.email_provider_id,
            &p.provider_attachment_id,
        )
        .await
        .context("Failed to fetch attachment data from Gmail")
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
fn determine_file_metadata(p: &AttachmentUploadMetadata) -> anyhow::Result<(String, String)> {
    let file_name = p
        .filename
        .split('.')
        .next()
        .unwrap_or(&p.filename)
        .to_string();

    let file_type = mime_guess::get_mime_extensions_str(&p.mime_type)
        .and_then(|exts| exts.first().map(|s| s.to_string()))
        .ok_or_else(|| {
            anyhow!(
                "Failed to determine file extension from mime type: {}",
                p.mime_type
            )
        })?;

    Ok((file_name, file_type))
}

/// Creates a document record in the Document Storage Service (DSS) and returns the response,
/// which includes the presigned URL for the upload.
async fn create_dss_document_record(
    dss_client: &DocumentStorageServiceClient,
    link: &link::Link,
    p: &AttachmentUploadMetadata,
    hex_hash: &str,
    file_name: &str,
    file_type: &str,
) -> anyhow::Result<CreateDocumentResponse> {
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

    dss_client
        .create_document_internal(request, &link.macro_id)
        .await
        .context("Failed to create document record in DSS")
}

/// Uploads the provided data to the presigned URL from the DSS response.
async fn upload_data_to_presigned_url(
    dss_response: &CreateDocumentResponse,
    attachment_data: Vec<u8>,
    base64_hash: &str,
) -> anyhow::Result<()> {
    let presigned_url = dss_response
        .data
        .document_response
        .presigned_url
        .as_ref()
        .context("DSS response did not include a presigned URL")?;

    let response = reqwest::Client::new()
        .put(presigned_url)
        .header("content-type", &dss_response.data.content_type)
        .header("x-amz-checksum-sha256", base64_hash)
        .body(attachment_data)
        .send()
        .await
        .context("HTTP PUT request to presigned URL failed")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Failed to upload attachment to presigned url: {} {}",
            status,
            body
        ));
    }

    Ok(())
}
