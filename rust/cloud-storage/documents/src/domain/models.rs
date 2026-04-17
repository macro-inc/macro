//! Domain models for the documents crate.

use macro_user_id::user_id::MacroUserIdStr;
use model::document::{DocumentMetadata, FileType};
use model::sync_service::SyncServiceVersionID;
use models_properties::api::requests::SetPropertyValue;

/// SHA256 hash of an empty string — used for empty markdown documents (tasks).
pub const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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

/// Response wrapper for the copy document endpoint.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CopyDocumentResponse {
    /// Indicates if an error occurred.
    pub error: bool,
    /// The copied document data.
    pub data: model::document::response::DocumentResponse,
}

/// Arguments for copying a document in the repository.
pub struct CopyDocumentRepoArgs {
    /// The original document metadata to copy from.
    pub original_document: DocumentMetadata,
    /// The new owner/copier user ID.
    pub user_id: MacroUserIdStr<'static>,
    /// The name for the new document.
    pub document_name: String,
    /// The file type of the document.
    pub file_type: Option<FileType>,
}

/// Request body for copying a document.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CopyDocumentRequest {
    /// The name of the new document (without extension).
    pub document_name: String,
    /// Optional sync service version ID for MD documents.
    pub version_id: Option<SyncServiceVersionID>,
}

/// Query parameters for the copy document endpoint.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CopyDocumentQueryParams {
    /// The DB version id of the document to copy. Defaults to latest.
    pub version_id: Option<i64>,
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

/// Represents a file type update: either set to a specific type or clear to null.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum FileTypeUpdate {
    /// Set the file type to a specific value.
    Set(FileType),
    /// Clear the file type (set to null).
    Clear,
}

/// Arguments for editing a document in the repository.
pub struct EditDocumentRepoArgs {
    /// The document ID to edit.
    pub document_id: String,
    /// New document name (None = no change).
    pub document_name: Option<String>,
    /// New project ID (None = no change, Some("") = remove from project).
    pub project_id: Option<String>,
    /// Updated share permissions.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
    /// New file type (None = no change).
    pub file_type: Option<FileTypeUpdate>,
}

/// Arguments for the edit_document service call.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EditDocumentServiceArgs {
    /// The name of the document.
    pub document_name: Option<String>,
    /// The new project id of the document.
    pub project_id: Option<String>,
    /// Updated share permissions for the document.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
    /// The new file type for the document (null to clear).
    #[serde(default)]
    pub file_type: Option<FileTypeUpdate>,
}

/// Query parameters for the location_v3 endpoint.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct LocationQueryParams {
    /// A specific document version id to get the location for.
    pub document_version_id: Option<i64>,
    /// If true, this will return the converted docx url.
    pub get_converted_docx_url: Option<bool>,
}

/// Property input for setting a property value on a task.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PropertyInput {
    /// The property definition ID.
    pub property_id: String,
    /// The value to set for the property.
    pub value: SetPropertyValue,
}

fn default_true() -> bool {
    true
}

/// Request body for creating a task.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    /// The name of the task.
    pub task_name: String,
    /// Optional project ID to associate the task with.
    pub project_id: Option<uuid::Uuid>,
    /// Optional property values to set on the task.
    pub property_values: Option<Vec<PropertyInput>>,
    /// Whether to share the task with your team or not
    /// Defaults to true
    #[serde(default = "default_true")]
    pub share_with_team: bool,
}

/// Response for creating a task.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResponse {
    /// The document ID of the created task.
    pub document_id: String,
}
