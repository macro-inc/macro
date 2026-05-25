//! Domain models for the documents crate.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::{DocumentMetadata, FileType};

use super::response::DocumentResponse;
use model::sync_service::SyncServiceVersionID;
use models_properties::api::requests::SetPropertyValue;
use serde_json::Value;

/// SHA256 hash of an empty string — used for empty markdown documents (tasks).
pub const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/// Assignee property id
pub const ASSIGNEES_PROPERTY_ID: &str = "00000001-0000-0000-0000-000000000001";

/// Status property id
pub const STATUS_PROPERTY_ID: &str = "00000001-0000-0000-0000-000000000002";

/// Not started status option
pub const NOT_STARTED_STATUS_OPTION_ID: uuid::Uuid =
    uuid::uuid!("00000001-0000-0000-0002-000000000001");

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
    pub data: DocumentResponse,
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
    /// Team that should receive a new per-team task number when copying a task.
    pub team_id: Option<uuid::Uuid>,
}

/// Immutable per-team task metadata assigned at task creation time.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, Copy)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamTaskMetadata {
    /// The team this task number is scoped to.
    pub team_id: uuid::Uuid,
    /// Monotonic task number within the team.
    pub task_num: i32,
}

/// User/team information needed to build a task branch name.
#[derive(Eq, PartialEq, Debug, Clone)]
pub struct BranchNameContext {
    /// The user's email address, used when no GitHub username is linked.
    pub user_email: String,
    /// Linked GitHub username for the user, when present.
    pub github_username: Option<String>,
    /// Slug for the user's team, when the user belongs to a team.
    pub team_slug: Option<String>,
    /// Task number for the document within the user's team, when present.
    pub team_task_id: Option<i32>,
}

/// A fully generated task branch name plus its short document id.
#[derive(Eq, PartialEq, Debug, Clone)]
pub struct TaskBranchName {
    /// The short id of the document.
    pub short_id: String,
    /// The generated branch name.
    pub branch_name: String,
}

/// Display-ready data for a GitHub pull request associated with a task.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequest {
    /// The stored GitHub association key, in `owner/repo/pull/number` format.
    pub github_key: String,
    /// The GitHub repository owner or organization.
    pub owner: String,
    /// The GitHub repository name.
    pub repo: String,
    /// The GitHub pull request number.
    pub number: u64,
    /// The public GitHub URL for the pull request.
    pub url: String,
    /// A compact label suitable for display in the UI.
    pub display_name: String,
}

impl GithubPullRequest {
    /// Parse a stored GitHub PR key in `owner/repo/pull/number` format.
    pub fn from_github_key(github_key: &str) -> Option<Self> {
        let mut parts = github_key.split('/');
        let (Some(owner), Some(repo), Some("pull"), Some(number), None) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            return None;
        };

        if owner.is_empty() || repo.is_empty() {
            return None;
        }

        let number = number.parse::<u64>().ok()?;
        let url = format!("https://github.com/{owner}/{repo}/pull/{number}");
        let display_name = format!("{owner}/{repo}#{number}");

        Some(Self {
            github_key: github_key.to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
            number,
            url,
            display_name,
        })
    }
}

/// Response containing all GitHub pull requests associated with a task.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GithubPullRequestsResponse {
    /// Parsed pull requests, in repository query order.
    pub pull_requests: Vec<GithubPullRequest>,
}

impl GithubPullRequestsResponse {
    /// Build a response from stored GitHub PR keys, skipping malformed rows.
    pub fn from_github_keys(github_keys: Vec<String>) -> Self {
        let mut pull_requests = Vec::new();

        for github_key in github_keys {
            match GithubPullRequest::from_github_key(&github_key) {
                Some(pull_request) => pull_requests.push(pull_request),
                None => tracing::warn!(
                    github_key = %github_key,
                    "skipping malformed GitHub pull request key"
                ),
            }
        }

        Self { pull_requests }
    }
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
    /// Team to use when assigning a per-team task number.
    pub team_id: Option<uuid::Uuid>,
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

/// Request body for creating a markdown document whose content is initialized
/// by the backend.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateMarkdownDocumentRequest {
    /// The document name.
    pub document_name: String,
    /// Markdown source text. Defaults to an empty document.
    pub markdown: Option<String>,
    /// Optional project ID to associate the document with.
    pub project_id: Option<uuid::Uuid>,
    /// Whether to add a viewed_at record for this document upon creation.
    #[serde(default)]
    pub skip_history: bool,
}

/// Response for creating a markdown document.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateMarkdownDocumentResponse {
    /// The document ID of the created markdown document.
    pub document_id: String,
}

/// Request body for creating a task.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    /// The name of the task.
    pub task_name: String,
    /// Markdown source text. Defaults to an empty task document.
    pub markdown: Option<String>,
    /// Optional project ID to associate the task with.
    pub project_id: Option<uuid::Uuid>,
    /// Team to assign the task number within. If omitted, it is inferred only
    /// when the creator belongs to exactly one team.
    pub team_id: Option<uuid::Uuid>,
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
    /// The team this task number is scoped to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<uuid::Uuid>,
    /// The task number assigned within the team.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_task_id: Option<i32>,
}

/// A comment thread attached to a document.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    /// The unique id of the thread.
    pub thread_id: i64,
    /// The user id of the thread owner.
    pub owner: String,
    /// Whether the thread has been resolved.
    pub resolved: bool,
    /// The document the thread is attached to.
    pub document_id: String,
    /// When the thread was created.
    pub created_at: Option<DateTime<Utc>>,
    /// When the thread was last updated.
    pub updated_at: Option<DateTime<Utc>>,
    /// When the thread was deleted, if ever.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Arbitrary thread metadata.
    pub metadata: Option<Value>,
}

/// A single comment in a thread.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// The unique id of the comment.
    pub comment_id: i64,
    /// The thread this comment belongs to.
    pub thread_id: i64,
    /// Ordering position within the thread.
    pub order: Option<i32>,
    /// The user id of the comment owner.
    pub owner: String,
    /// Sender display string.
    pub sender: Option<String>,
    /// Comment body.
    pub text: String,
    /// Arbitrary comment metadata.
    pub metadata: Option<Value>,
    /// When the comment was created.
    pub created_at: Option<DateTime<Utc>>,
    /// When the comment was last updated.
    pub updated_at: Option<DateTime<Utc>>,
    /// When the comment was deleted, if ever.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A thread bundled together with its ordered comments.
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CommentThread {
    /// The thread metadata.
    pub thread: Thread,
    /// The comments in the thread, ordered by `createdAt` ASC.
    pub comments: Vec<Comment>,
}
