//! Port definitions for the documents domain.
//!
//! These traits define the contracts that adapters must implement.

use std::future::Future;

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::response::{
    CreateDocumentResponseData, GetDocumentResponseData, LocationResponseV3,
};
use model::document::{ContentType, DocumentBasic, DocumentMetadata};

use model::sync_service::SyncServiceVersionID;

use super::models::{
    CommentThread, CopyDocumentRepoArgs, CreateDocumentRepoArgs, CreateTaskRequest,
    CreateTaskResponse, DocumentError, EditDocumentRepoArgs, EditDocumentServiceArgs,
    LocationQueryParams,
};

/// Repository for accessing document data from the database.
///
/// All methods perform database operations — SQL queries are written
/// directly in the outbound adapter implementation.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait DocumentRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Get full document metadata (including latest version, BOM, project info).
    fn get_document_metadata(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<DocumentMetadata, Self::Err>> + Send;

    /// Get a user's last view location within a document.
    fn get_user_view_location(
        &self,
        user_id: &str,
        document_id: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Get basic document info (used by middleware and access checks).
    fn get_basic_document(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<DocumentBasic, Self::Err>> + Send;

    /// Soft-delete a document (remove pins/history, set deletedAt).
    fn soft_delete_document(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get the latest document version ID (for editable files: js, py).
    /// Returns (version_id, uploaded).
    fn get_latest_document_version_id(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<(i64, bool), Self::Err>> + Send;

    /// Get the document version ID (for static files: pdf, images).
    /// Returns (version_id, uploaded).
    fn get_document_version_id(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<(i64, bool), Self::Err>> + Send;

    /// Get document SHAs for a specific document version (BOM parts).
    fn get_document_shas(
        &self,
        document_version_id: i64,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;

    /// Get document SHAs by document ID (latest BOM).
    fn get_document_shas_by_document_id(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;

    /// Get document text by document ID
    fn get_document_text(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<String, Self::Err>> + Send;

    /// Get all comment threads (with their comments) attached to a document.
    fn get_document_comments(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<Vec<CommentThread>, Self::Err>> + Send;

    /// Create a new document with all associated records in a single transaction.
    ///
    /// Handles: Document row, version (DocumentInstance or DocumentBom),
    /// document_sub_type, SharePermission, DocumentPermission, UserHistory,
    /// ItemLastAccessed, UserItemAccess, and document_email.
    fn create_document(
        &self,
        args: CreateDocumentRepoArgs,
    ) -> impl Future<Output = Result<DocumentMetadata, Self::Err>> + Send;

    /// Update an upload job to associate it with a document.
    fn update_upload_job(
        &self,
        document_id: &str,
        job_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Edit a document's metadata and share permissions in a single transaction.
    ///
    /// Updates: Document name, project ID, share permissions, and user item access.
    fn edit_document(
        &self,
        args: EditDocumentRepoArgs,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Update a project's `updatedAt` timestamp.
    fn update_project_modified(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete a document by ID (used for error cleanup).
    fn delete_document_by_id(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Share a document with all members of the user's team.
    fn share_with_team(
        &self,
        user_id: &str,
        document_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get document metadata at a specific version ID.
    fn get_document_metadata_at_version(
        &self,
        document_id: &str,
        version_id: i64,
    ) -> impl Future<Output = Result<DocumentMetadata, Self::Err>> + Send;

    /// Get the owner of a project by project ID.
    fn get_project_owner(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<MacroUserIdStr<'static>, Self::Err>> + Send;

    /// Copy a document's DB records in a single transaction.
    ///
    /// Creates: Document row, version (DocumentBom or DocumentInstance),
    /// SharePermission, DocumentPermission, UserItemAccess, and user history.
    fn copy_document(
        &self,
        args: CopyDocumentRepoArgs,
    ) -> impl Future<Output = Result<DocumentMetadata, Self::Err>> + Send;

    /// Copy PDF-specific data (DocumentText, DocumentProcessResult) for a copied document.
    fn copy_pdf_parts(
        &self,
        new_document_id: &str,
        original_document_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Port for generating S3 presigned upload URLs.
pub trait PresignedUploadUrlPort: Send + Sync + 'static {
    /// Generate a presigned URL for uploading to the document storage bucket.
    fn put_document_storage_presigned_url(
        &self,
        key: &str,
        sha: &str,
        content_type: ContentType,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Generate a presigned URL for uploading to the docx upload bucket.
    fn put_docx_upload_presigned_url(
        &self,
        key: &str,
        sha: &str,
        content_type: ContentType,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Copy a document object from source key to destination key within the storage bucket.
    fn copy_object(
        &self,
        source_key: &str,
        destination_key: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Port for attaching task system properties.
pub trait TaskPropertiesPort: Send + Sync + 'static {
    /// Attach initial (null-valued) task properties to entities.
    fn attach_task_properties(
        &self,
        entity_ids: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Updates the tasks status
    fn update_task_status(
        &self,
        entity_id: &str,
        status: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Set a property value on an entity.
    fn set_entity_property(
        &self,
        user_id: &str,
        entity_id: &str,
        property_definition_id: uuid::Uuid,
        value: Option<models_properties::api::requests::SetPropertyValue>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Copy all task property values from one task to another.
    fn copy_task_properties(
        &self,
        from_task_id: &str,
        to_task_id: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Service interface for document operations.
///
/// Orchestrates business logic using the repository and external services.
pub trait DocumentService: Send + Sync + 'static {
    /// Gets the basic document ignoring access checks
    fn internal_get_basic_document(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<DocumentBasic, DocumentError>> + Send;

    /// Get a document with metadata, access level, and view location.
    fn get_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<GetDocumentResponseData, DocumentError>> + Send;

    /// Get the location (presigned URL or sync service content) for a document.
    fn get_document_location(
        &self,
        document_context: &DocumentBasic,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        params: LocationQueryParams,
    ) -> impl Future<Output = Result<LocationResponseV3, DocumentError>> + Send;

    /// Soft-delete a document and update project modified timestamp.
    fn delete_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project_id: Option<String>,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Get the document text for a given document
    fn get_document_text(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<String, DocumentError>> + Send;

    /// Get all comment threads (with their comments) for a document.
    fn get_document_comments(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<CommentThread>, DocumentError>> + Send;

    /// Create a new document, generate an S3 presigned upload URL, and
    /// optionally attach task properties and update project modified.
    fn create_document(
        &self,
        user_id: MacroUserIdStr<'static>,
        args: CreateDocumentRepoArgs,
        job_id: Option<String>,
    ) -> impl Future<Output = Result<CreateDocumentResponseData, DocumentError>> + Send;

    /// Convert a document's entity_id to a short UUID.
    fn get_short_id(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<String, DocumentError>> + Send;

    /// Edit a document's metadata and share permissions.
    ///
    /// Validates permissions, updates the document, sends invalidation event,
    /// and updates project modified timestamp.
    fn edit_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        document_context: DocumentBasic,
        args: EditDocumentServiceArgs,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Updates the tasks status to what is provided
    fn update_task_status(
        &self,
        entity_access_receipt: EntityAccessReceipt<EditAccessLevel>,
        status: &str,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Copy an existing document, creating a new document with the same content.
    fn copy_document(
        &self,
        entity_access_receipt: EntityAccessReceipt<ViewAccessLevel>,
        document_context: DocumentBasic,
        user_id: MacroUserIdStr<'static>,
        document_name: String,
        query_version_id: Option<i64>,
        sync_version_id: Option<SyncServiceVersionID>,
    ) -> impl Future<Output = Result<model::document::response::DocumentResponse, DocumentError>> + Send;

    /// Create a task document and optionally set property values on it.
    fn create_task(
        &self,
        user_id: MacroUserIdStr<'static>,
        plain_user_id: String,
        request: CreateTaskRequest,
    ) -> impl Future<Output = Result<CreateTaskResponse, DocumentError>> + Send;

    /// Assigns the task properties to a document
    fn handle_task_properties(
        &self,
        user_id: MacroUserIdStr<'static>,
        document_id: &str,
        request: &CreateTaskRequest,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}
