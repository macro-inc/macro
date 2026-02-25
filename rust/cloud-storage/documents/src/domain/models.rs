//! Domain models for the documents crate.

use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;

/// Errors that can occur during document operations.
#[derive(Debug, thiserror::Error)]
pub enum DocumentError {
    /// The requested document was not found.
    #[error("document not found: {0}")]
    NotFound(String),
    /// The user is not authorized to perform this action.
    #[error("unauthorized")]
    Unauthorized,
    /// The document does not exist in storage (S3/sync service).
    #[error("document does not exist in storage")]
    Gone,
    /// A conflict occurred (e.g. duplicate document ID).
    #[error("conflict: {0}")]
    Conflict(String),
    /// A bad request was made.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

/// Arguments for creating a document in the repository.
pub struct CreateDocumentRepoArgs {
    /// Optional user-provided document ID.
    pub id: Option<uuid::Uuid>,
    /// SHA256 hash of the document content.
    pub sha: String,
    /// Document name without extension.
    pub document_name: String,
    /// The owner/creator of the document.
    pub user_id: MacroUserIdStr<'static>,
    /// File type of the document.
    pub file_type: Option<FileType>,
    /// Project to associate the document with.
    pub project_id: Option<uuid::Uuid>,
    /// Email attachment to link (internal only).
    pub email_attachment_id: Option<uuid::Uuid>,
    /// Custom creation timestamp.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether the document is a task (MD files only).
    pub is_task: bool,
    /// Whether to skip adding to user history.
    pub skip_history: bool,
}

/// Configuration for CloudFront presigned URL generation.
pub struct CloudFrontConfig {
    /// The CloudFront distribution URL.
    pub distribution_url: String,
    /// The public key ID for the CloudFront signer.
    pub signer_public_key_id: String,
    /// The private key for the CloudFront signer.
    pub signer_private_key: String,
    /// Number of seconds before a presigned URL expires.
    pub presigned_url_expiry_seconds: u64,
    /// Number of seconds for browser cache expiry (Cache-Control max-age).
    pub browser_cache_expiry_seconds: u64,
}

/// Query parameters for the location_v3 endpoint.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct LocationQueryParams {
    /// A specific document version id to get the location for.
    pub document_version_id: Option<i64>,
    /// If true, this will return the converted docx url.
    pub get_converted_docx_url: Option<bool>,
}
