use crate::pubsub::util::check_gmail_rate_limit;
use crate::util::redis::RedisClient;
use anyhow::{Context, anyhow};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use document_storage_service_client::DocumentStorageServiceClient;
use gmail_client::GmailClient;
use macro_user_id::cowlike::ArcCowStr;
use macro_user_id::user_id::MacroUserId;
use model::document::response::{CreateDocumentRequest, CreateDocumentResponse};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::attachment::{
    AttachmentSfs, AttachmentUploadArgs, AttachmentUploadMetadata,
};
use models_email::service::link;
use sha2::{Digest, Sha256};
use static_file_service_client::StaticFileServiceClient;
use std::sync::Arc;
use system_properties::{
    EmailAttachmentInput, EmailAttachmentProperty, PgSystemPropertiesRepository, SourceEntity,
    SystemPropertiesService, SystemPropertiesServiceImpl,
};
use uuid::Uuid;

/// Context required for uploading an email attachment.
pub struct UploadAttachmentContext<'a> {
    pub db: &'a sqlx::Pool<sqlx::Postgres>,
    pub redis_client: &'a RedisClient,
    pub gmail_client: &'a GmailClient,
    pub dss_client: &'a DocumentStorageServiceClient,
    pub sfs_client: &'a StaticFileServiceClient,
    pub system_properties_service:
        &'a Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub access_token: &'a str,
    pub link: &'a link::Link,
}

/// Upload an email attachment to DSS as a document or SFS as media.
#[tracing::instrument(skip(ctx, args), err)]
pub async fn upload_attachment(
    ctx: UploadAttachmentContext<'_>,
    args: &AttachmentUploadArgs,
) -> anyhow::Result<String> {
    // 1. Check rate limits before making a Gmail API call.
    check_gmail_rate_limit(
        ctx.redis_client,
        ctx.link.id,
        GmailApiOperation::MessagesAttachmentsGet,
        true,
    )
    .await
    .context("Rate limit check failed")?;

    // 2. Fetch the raw attachment data from Gmail.
    let attachment_data = fetch_gmail_attachment_data(
        ctx.gmail_client,
        ctx.access_token,
        &args.attachment_metadata,
    )
    .await?;

    let mime_type = args.attachment_metadata.mime_type.clone();

    match args.upload_destination {
        models_email::service::attachment::AttachmentUploadDestination::Sfs => {
            upload_media_attachment(&ctx, args, attachment_data, mime_type).await
        }
        models_email::service::attachment::AttachmentUploadDestination::Dss => {
            upload_document_attachment(&ctx, args, attachment_data).await
        }
    }
}

/// Uploads an image or video attachment to SFS.
#[tracing::instrument(skip(ctx, attachment_data), err)]
async fn upload_media_attachment(
    ctx: &UploadAttachmentContext<'_>,
    args: &AttachmentUploadArgs,
    attachment_data: Vec<u8>,
    mime_type: String,
) -> anyhow::Result<String> {
    // Upload to SFS
    let sfs_response = ctx
        .sfs_client
        .put_file_with_bytes("a", bytes::Bytes::from(attachment_data), mime_type)
        .await
        .context("Failed to upload media to SFS")?;

    // Store metadata in email_attachments_sfs table
    let attachment_sfs_id = macro_uuid::generate_uuid_v7();
    let sfs_id = Uuid::parse_str(&sfs_response.id).context("Failed to parse SFS ID as UUID")?;

    email_db_client::attachments::sfs::insert_attachment_sfs(
        ctx.db,
        &AttachmentSfs {
            id: attachment_sfs_id,
            attachment_id: Some(args.attachment_metadata.attachment_db_id),
            sfs_id,
        },
    )
    .await?;

    Ok(sfs_response.id)
}

/// Uploads a document attachment to DSS.
#[tracing::instrument(skip(ctx, attachment_data), err)]
async fn upload_document_attachment(
    ctx: &UploadAttachmentContext<'_>,
    args: &AttachmentUploadArgs,
    attachment_data: Vec<u8>,
) -> anyhow::Result<String> {
    // 1. Calculate hashes required for the upload process.
    let (hex_hash, base64_hash) = calculate_hashes(&attachment_data);

    // 2. Determine file metadata from the payload.
    let (file_name, file_type) = determine_file_metadata(&args.attachment_metadata)?;

    // 3. Create the document record in DSS and get a presigned URL for the upload.
    let dss_response = create_dss_document_record(
        ctx.dss_client,
        ctx.link,
        &args.attachment_metadata,
        &hex_hash,
        &file_name,
        &file_type,
        args.backfill,
    )
    .await?;

    // 4. Upload the attachment data to the presigned URL.
    upload_data_to_presigned_url(&dss_response, attachment_data, &base64_hash).await?;

    // 5. Get document id
    let document_id = dss_response
        .data
        .document_response
        .document_metadata
        .document_id
        .clone();

    // 6. Set properties for attachment
    set_email_attachment_properties(ctx.system_properties_service, &document_id, args).await?;

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
    // documents must have a file name to be inserted into Document table.
    let file_name = p
        .filename
        .as_deref()
        .context("attachment filename is missing")?;

    let file_name = file_name.split('.').next().unwrap_or(file_name).to_string();

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
    backfill: bool,
) -> anyhow::Result<CreateDocumentResponse> {
    // if we are backfilling, use the email timestamp. if it's an on-demand upload, use the current
    // time so the document shows up at the top of soup views.
    let created_at = backfill.then_some(p.internal_date_ts);

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
        created_at,
        email_attachment_id: Some(p.attachment_db_id),
        is_task: false,
    };

    dss_client
        .create_document_internal(request, link.macro_id.0.as_ref())
        .await
        .map_err(|e| anyhow::anyhow!("Failed to create document record in DSS: {}", e))
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

/// Sets email attachment properties for the uploaded document.
#[tracing::instrument(skip(system_properties_service, p))]
async fn set_email_attachment_properties(
    system_properties_service: &Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    document_id: &str,
    p: &AttachmentUploadArgs,
) -> anyhow::Result<()> {
    let sender_email = format!("macro|{}", p.attachment_metadata.sender_email);
    let sender = MacroUserId::parse_from_str(&sender_email)
        .with_context(|| {
            format!(
                "Failed to parse sender email {} into macro user id",
                p.attachment_metadata.sender_email
            )
        })?
        .lowercase();

    // parse_from_str only accepts &str, so we need to store prefixed emails somewhere that outlives parsing
    let prefixed_emails: Vec<String> = p
        .recipient_emails
        .iter()
        .map(|email| format!("macro|{}", email))
        .collect();

    let recipients: Result<Vec<MacroUserId<ArcCowStr>>, _> = prefixed_emails
        .iter()
        .map(|email| {
            MacroUserId::parse_from_str(email).with_context(|| {
                format!(
                    "Failed to parse recipient email {} into macro user id",
                    email
                )
            })
        })
        .collect();

    let recipients: Vec<_> = recipients?.into_iter().map(|id| id.lowercase()).collect();

    system_properties_service
        .set_email_attachment_properties(vec![EmailAttachmentInput {
            entity_id: document_id.to_string(),
            properties: EmailAttachmentProperty {
                source: Some(SourceEntity {
                    entity_type: models_properties::EntityType::Thread,
                    entity_id: p.attachment_metadata.thread_db_id.to_string(),
                    specific_message_id: Some(p.attachment_metadata.message_db_id),
                }),
                // TODO: companies support
                companies: None,
                sender: Some(sender),
                recipients: Some(recipients),
                subject: p.attachment_metadata.subject.clone(),
            },
        }])
        .await
        .context("Failed to set email attachment properties")?;

    Ok(())
}
