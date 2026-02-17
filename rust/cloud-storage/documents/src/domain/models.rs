//! Domain models for the documents crate.

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
    /// An internal error occurred.
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
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
