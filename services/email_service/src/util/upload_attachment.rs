use crate::outbound::email_api::GmailApi;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use document_storage_service_client::DocumentStorageServiceClient;
use document_storage_service_client::document::CreateDocumentInternalError;
use email_api_client::domain::models::EmailApiError;
use macro_user_id::lowercased::Lowercase;
use macro_user_id::user_id::{MacroUserId, MacroUserIdStr};
use model::document::response::{CreateDocumentRequest, CreateDocumentResponse};
use model::document::{FileTypeExt, MAX_DOCUMENT_NAME_GRAPHEMES};
use model_file_type::FileType;
use models_email::service::attachment::{
    AttachmentSfs, AttachmentUploadArgs, AttachmentUploadMetadata,
};
use models_email::service::link;
use nom::Parser;
use nom::bytes::complete::{tag, take_until};
use nom::character::complete::alphanumeric1;
use nom::sequence::{preceded, terminated};
use sha2::{Digest, Sha256};
use static_file_service_client::StaticFileServiceClient;
use std::str::FromStr;
use std::sync::Arc;
use system_properties::{
    EmailAttachmentInput, EmailAttachmentProperty, PgSystemPropertiesRepository, SourceEntity,
    SystemPropertiesService, SystemPropertiesServiceImpl,
};
use thiserror::Error;
use unicode_segmentation::UnicodeSegmentation;
use uuid::Uuid;

#[cfg(test)]
mod test;

#[derive(Error, Debug)]
pub enum UploadAttachmentError {
    #[error("Gmail API rate limit exceeded")]
    RateLimited(EmailApiError),

    #[error("Failed to fetch attachment data from Gmail: {0}")]
    GmailFetchFailed(EmailApiError),

    #[error("Failed to upload media to SFS: {0}")]
    SfsUploadFailed(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Database error: {0}")]
    DatabaseError(anyhow::Error),

    #[error("Attachment filename is missing")]
    FilenameMissing,

    #[error(
        "Failed to determine file extension from mime type ({mime_type}) or filename ({filename})"
    )]
    FileExtensionDeterminationFailed { mime_type: String, filename: String },

    #[error("Failed to create document record in DSS: {0}")]
    DssCreateFailed(String),

    /// The attachment row was deleted before DSS could link it, e.g. a
    /// superseded draft revision. There is nothing left to import.
    #[error("Attachment was deleted before it could be imported")]
    AttachmentDeleted,

    /// The upload never got an answer. The error carries no URL: a presigned
    /// URL's query holds its credentials and session token.
    #[error("Failed to send attachment to presigned URL: {0}")]
    PresignedUrlUnreachable(reqwest::Error),

    #[error(
        "Failed to upload attachment to presigned URL. Status: {status}, code: {}",
        code.as_deref().unwrap_or("none")
    )]
    PresignedUrlRefused {
        status: reqwest::StatusCode,
        /// The S3 error `<Code>`, the only part of the body kept.
        code: Option<String>,
    },

    #[error("Failed to set email attachment properties: {0}")]
    SystemPropertiesSetFailed(String),
}

/// Context required for uploading an email attachment.
pub struct UploadAttachmentContext<'a> {
    pub db: &'a sqlx::Pool<sqlx::Postgres>,
    pub email_api: &'a GmailApi,
    pub dss_client: &'a DocumentStorageServiceClient,
    pub sfs_client: &'a StaticFileServiceClient,
    pub system_properties_service:
        &'a Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub link: &'a link::Link,
}

/// Provider-independent storage context for already downloaded attachment bytes.
pub struct AttachmentStorageContext<'a> {
    pub db: &'a sqlx::PgPool,
    pub dss_client: &'a DocumentStorageServiceClient,
    pub sfs_client: &'a StaticFileServiceClient,
    pub system_properties_service:
        &'a Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    pub link: &'a link::Link,
}

/// Upload an email attachment to DSS as a document or SFS as media.
pub async fn upload_attachment(
    ctx: UploadAttachmentContext<'_>,
    args: &AttachmentUploadArgs,
) -> Result<String, UploadAttachmentError> {
    // Fetching through the email API service applies this context's token and quota policy.
    let attachment_data =
        fetch_gmail_attachment_data(ctx.email_api, ctx.link, &args.attachment_metadata).await?;

    store_attachment(
        AttachmentStorageContext {
            db: ctx.db,
            dss_client: ctx.dss_client,
            sfs_client: ctx.sfs_client,
            system_properties_service: ctx.system_properties_service,
            link: ctx.link,
        },
        args,
        attachment_data,
    )
    .await
}

/// Share DSS/SFS persistence across providers after scoped download succeeds.
pub async fn store_attachment(
    ctx: AttachmentStorageContext<'_>,
    args: &AttachmentUploadArgs,
    attachment_data: Vec<u8>,
) -> Result<String, UploadAttachmentError> {
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
#[tracing::instrument(
    skip(ctx, args, attachment_data),
    fields(attachment_id = %args.attachment_metadata.attachment_db_id),
    err
)]
async fn upload_media_attachment(
    ctx: &AttachmentStorageContext<'_>,
    args: &AttachmentUploadArgs,
    attachment_data: Vec<u8>,
    mime_type: String,
) -> Result<String, UploadAttachmentError> {
    // Upload to SFS
    let sfs_response = ctx
        .sfs_client
        .put_file_with_bytes("a", bytes::Bytes::from(attachment_data), mime_type)
        .await
        .map_err(|e| UploadAttachmentError::SfsUploadFailed(e.to_string()))?;

    // Store metadata in email_attachments_sfs table
    let attachment_sfs_id = macro_uuid::generate_uuid_v7();
    let sfs_id = Uuid::parse_str(&sfs_response.id).map_err(|e| {
        UploadAttachmentError::ParseError(format!("Failed to parse SFS ID as UUID: {}", e))
    })?;

    email_db_client::attachments::sfs::insert_attachment_sfs(
        ctx.db,
        &AttachmentSfs {
            id: attachment_sfs_id,
            attachment_id: Some(args.attachment_metadata.attachment_db_id),
            sfs_id,
        },
    )
    .await
    .map_err(UploadAttachmentError::DatabaseError)?;

    Ok(sfs_response.id)
}

/// Uploads a document attachment to DSS.
#[tracing::instrument(
    skip(ctx, args, attachment_data),
    fields(attachment_id = %args.attachment_metadata.attachment_db_id)
)]
async fn upload_document_attachment(
    ctx: &AttachmentStorageContext<'_>,
    args: &AttachmentUploadArgs,
    attachment_data: Vec<u8>,
) -> Result<String, UploadAttachmentError> {
    // A deleted attachment is an expected outcome, not a failure.
    store_document_attachment(ctx, args, attachment_data)
        .await
        .inspect_err(|error| {
            if !matches!(error, UploadAttachmentError::AttachmentDeleted) {
                tracing::error!(error = %error, "document attachment upload failed");
            }
        })
}

async fn store_document_attachment(
    ctx: &AttachmentStorageContext<'_>,
    args: &AttachmentUploadArgs,
    attachment_data: Vec<u8>,
) -> Result<String, UploadAttachmentError> {
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

    if let Some(presigned_url) = &dss_response.data.document_response.presigned_url {
        upload_data_to_presigned_url(
            presigned_url,
            &dss_response.data.content_type,
            attachment_data,
            &base64_hash,
        )
        .await?;
    }

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
    email_api: &GmailApi,
    link: &link::Link,
    p: &AttachmentUploadMetadata,
) -> Result<Vec<u8>, UploadAttachmentError> {
    email_api
        .get_attachment(link.id, &p.email_provider_id, &p.provider_attachment_id)
        .await
        .map_err(|error| match error {
            error @ EmailApiError::RateLimited { .. } => UploadAttachmentError::RateLimited(error),
            // Preserve the provider error so API handlers can map it to the
            // right status instead of collapsing everything to 500.
            error => UploadAttachmentError::GmailFetchFailed(error),
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

/// Determines the document name and file type (extension) from the payload.
///
/// The name is the filename without a Macro file type's extension, as uploads
/// name documents, or the whole filename without one. That extension is also
/// the file type unless the MIME type names a different Macro file type: mail
/// clients send many files as `application/octet-stream`, and the first
/// extension `mime_guess` lists for a broad MIME type is often not a Macro
/// type at all (`text/plain` gives `asm`), but a specific MIME type such as
/// `application/pdf` describes the content better than a mismatched name.
/// Without such an extension the MIME type decides.
pub fn determine_file_metadata(
    p: &AttachmentUploadMetadata,
) -> Result<(String, String), UploadAttachmentError> {
    // documents must have a file name to be inserted into Document table.
    let original_file_name = p
        .filename
        .as_deref()
        .ok_or(UploadAttachmentError::FilenameMissing)?;
    let trimmed_file_name = original_file_name.trim();

    let known = FileType::split_suffix_match(trimmed_file_name)
        .filter(|(name, _)| !name.trim().is_empty())
        .and_then(|(name, extension)| Some((name, FileType::from_str(extension).ok()?)));
    let file_name = known.map_or(trimmed_file_name, |(name, _)| name);

    let file_type = match known {
        Some((_, file_type)) if !names_another_type(file_type, &p.mime_type) => {
            file_type.as_str().to_string()
        }
        _ => mime_guess::get_mime_extensions_str(&p.mime_type)
            .and_then(|exts| exts.first().map(|s| s.to_string()))
            .or_else(|| {
                // if mime_guess fails, use everything after the last '.' in the original filename
                original_file_name
                    .rsplit_once('.')
                    .map(|(_, ext)| ext.trim())
                    .filter(|ext| !ext.is_empty())
                    .map(|ext| ext.to_string())
            })
            .ok_or_else(|| UploadAttachmentError::FileExtensionDeterminationFailed {
                mime_type: p.mime_type.clone(),
                filename: original_file_name.to_string(),
            })?,
    };

    Ok((truncate_document_name(file_name).to_string(), file_type))
}

/// MIME types that say nothing about a file's format: a byte stream, or a zip
/// container such as every Office document is.
const GENERIC_MIME_TYPES: [&str; 3] = [
    "application/octet-stream",
    "application/zip",
    "application/x-zip-compressed",
];

/// Whether `mime_type` names a Macro file type other than `file_type`: its
/// first `mime_guess` extension is one, the MIME type is not generic or
/// `file_type`'s own, and `mime_guess` does not list `file_type`'s extension
/// for it.
fn names_another_type(file_type: FileType, mime_type: &str) -> bool {
    // if it's a heic, the mime_type can sometimes be heif. hardcode file_type to match file name
    if file_type == FileType::Heic
        || GENERIC_MIME_TYPES
            .iter()
            .any(|generic| generic.eq_ignore_ascii_case(mime_type))
        || file_type.mime_type().eq_ignore_ascii_case(mime_type)
    {
        return false;
    }
    let extensions = mime_guess::get_mime_extensions_str(mime_type).unwrap_or_default();
    !extensions
        .iter()
        .any(|extension| extension.eq_ignore_ascii_case(file_type.as_str()))
        && extensions
            .first()
            .and_then(|extension| FileType::from_str(extension).ok())
            .is_some_and(|named| named != file_type)
}

/// DSS rejects longer names, so keep only the leading graphemes rather than drop the attachment.
fn truncate_document_name(name: &str) -> &str {
    name.grapheme_indices(true)
        .nth(MAX_DOCUMENT_NAME_GRAPHEMES)
        .map_or(name, |(end, _)| &name[..end])
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
) -> Result<CreateDocumentResponse, UploadAttachmentError> {
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
        team_id: None,
        created_at,
        email_attachment_id: Some(p.attachment_db_id),
        is_task: false,
        skip_history: true,
    };

    dss_client
        .create_document_internal(request, link.macro_id.0.as_ref())
        .await
        .map_err(|e| match e {
            CreateDocumentInternalError::EmailAttachmentNotFound => {
                UploadAttachmentError::AttachmentDeleted
            }
            e => UploadAttachmentError::DssCreateFailed(e.to_string()),
        })
}

/// Uploads the provided data to the presigned URL from the DSS response.
async fn upload_data_to_presigned_url(
    presigned_url: &str,
    content_type: &str,
    attachment_data: Vec<u8>,
    base64_hash: &str,
) -> Result<(), UploadAttachmentError> {
    // Without the explicit length an empty file goes out with no
    // Content-Length at all, which storage refuses with 411.
    let response = reqwest::Client::new()
        .put(presigned_url)
        .header("content-type", content_type)
        .header("content-length", attachment_data.len())
        .header("x-amz-checksum-sha256", base64_hash)
        .body(attachment_data)
        .send()
        .await
        .map_err(|error| UploadAttachmentError::PresignedUrlUnreachable(error.without_url()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(UploadAttachmentError::PresignedUrlRefused {
            status,
            code: s3_error_code(&body),
        });
    }

    Ok(())
}

/// The `<Code>` of an S3 error response, such as `SignatureDoesNotMatch` or
/// `SlowDown`. The rest of the body can echo the signed request, the presigned
/// URL's credentials and session token included, so nothing else is read.
pub fn s3_error_code(body: &str) -> Option<String> {
    let mut code = preceded(
        (take_until("<Code>"), tag("<Code>")),
        terminated(alphanumeric1, tag("</Code>")),
    );
    let parsed: nom::IResult<&str, &str> = code.parse(body);
    parsed.ok().map(|(_, code)| code.to_owned())
}

/// Sets email attachment properties for the uploaded document.
#[tracing::instrument(skip(system_properties_service, p))]
async fn set_email_attachment_properties(
    system_properties_service: &Arc<SystemPropertiesServiceImpl<PgSystemPropertiesRepository>>,
    document_id: &str,
    p: &AttachmentUploadArgs,
) -> Result<(), UploadAttachmentError> {
    system_properties_service
        .set_email_attachment_properties(vec![EmailAttachmentInput {
            entity_id: document_id.to_string(),
            properties: email_attachment_property(p),
        }])
        .await
        .map_err(|e| UploadAttachmentError::SystemPropertiesSetFailed(e.to_string()))?;

    Ok(())
}

/// Builds the attachment's properties from its message.
///
/// Header addresses are stored as Gmail sent them, so some are not valid Macro
/// user ids. Those are left out rather than dropping every property.
fn email_attachment_property(p: &AttachmentUploadArgs) -> EmailAttachmentProperty<'static> {
    EmailAttachmentProperty {
        source: Some(SourceEntity {
            entity_type: models_properties::EntityType::Thread,
            entity_id: p.attachment_metadata.thread_db_id.to_string(),
            specific_message_id: Some(p.attachment_metadata.message_db_id),
        }),
        // TODO: companies support
        companies: None,
        sender: p
            .attachment_metadata
            .sender_email
            .as_deref()
            .and_then(|email| macro_user_id(p, email)),
        recipients: Some(
            p.recipient_emails
                .iter()
                .filter_map(|email| macro_user_id(p, email))
                .collect(),
        ),
        subject: p.attachment_metadata.subject.clone(),
    }
}

fn macro_user_id(p: &AttachmentUploadArgs, email: &str) -> Option<MacroUserId<Lowercase<'static>>> {
    match MacroUserIdStr::try_from_email(email) {
        Ok(id) => Some(id.0),
        // The parse error echoes the address, so it stays out of the log.
        Err(_) => {
            tracing::warn!(
                message_id = %p.attachment_metadata.message_db_id,
                "Leaving an address that is not a valid Macro user id out of attachment properties"
            );
            None
        }
    }
}
