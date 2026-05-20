//! Port definitions for backend-owned document creation.

use std::future::Future;
use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::content::DocumentContent;
use crate::domain::models::{CreateDocumentRepoArgs, CreateTaskRequest, DocumentError};
use crate::domain::response::CreateDocumentResponseData;

/// Uploaded document bytes and metadata for a presigned object-storage URL.
pub struct DocumentBytesUpload {
    /// Presigned URL to upload bytes to.
    pub presigned_url: String,
    /// Content type to send with the upload.
    pub content_type: String,
    /// Base64-encoded SHA-256 checksum to send with the upload.
    pub base64_sha256: String,
    /// Bytes to upload.
    pub bytes: Vec<u8>,
}

/// Uploads document bytes to object storage using a presigned URL.
pub trait DocumentBytesUploadPort: Send + Sync {
    /// Upload document bytes.
    fn upload_document_bytes(
        &self,
        upload: DocumentBytesUpload,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// Service operations needed by backend-owned document creation.
pub trait DocumentCreationService: Send + Sync {
    /// Create a document metadata row and any service-owned creation side effects.
    fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> impl Future<Output = Result<CreateDocumentResponseData, DocumentError>> + Send;

    /// Assign task properties to a markdown task document.
    fn handle_task_properties(
        &self,
        user_id: MacroUserIdStr<'static>,
        document_id: &str,
        request: &CreateTaskRequest,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Resolve the team to use for per-team task numbering.
    fn resolve_task_team_id(
        &self,
        user_id: MacroUserIdStr<'static>,
        requested_team_id: Option<uuid::Uuid>,
    ) -> impl Future<Output = Result<uuid::Uuid, DocumentError>> + Send;

    /// Mark a created document's upload/finalization lifecycle as complete.
    fn mark_document_uploaded(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Set a created document's persisted content lifecycle metadata.
    fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Clean up a document that failed after its database row was created.
    fn cleanup_created_document(&self, document_id: &str) -> impl Future<Output = ()> + Send;
}

impl<T> DocumentCreationService for Arc<T>
where
    T: DocumentCreationService + ?Sized,
{
    async fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> Result<CreateDocumentResponseData, DocumentError> {
        (**self).create_document(user_id, args, job_id).await
    }

    async fn handle_task_properties(
        &self,
        user_id: MacroUserIdStr<'static>,
        document_id: &str,
        request: &CreateTaskRequest,
    ) -> Result<(), DocumentError> {
        (**self)
            .handle_task_properties(user_id, document_id, request)
            .await
    }

    async fn resolve_task_team_id(
        &self,
        user_id: MacroUserIdStr<'static>,
        requested_team_id: Option<uuid::Uuid>,
    ) -> Result<uuid::Uuid, DocumentError> {
        (**self)
            .resolve_task_team_id(user_id, requested_team_id)
            .await
    }

    async fn mark_document_uploaded(&self, document_id: &str) -> Result<(), DocumentError> {
        (**self).mark_document_uploaded(document_id).await
    }

    async fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        (**self).set_document_content(document_id, content).await
    }

    async fn cleanup_created_document(&self, document_id: &str) {
        (**self).cleanup_created_document(document_id).await
    }
}
