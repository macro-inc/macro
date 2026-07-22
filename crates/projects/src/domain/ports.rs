//! Port definitions for the projects domain.
//!
//! These traits define the contracts implemented by inbound-facing services
//! and outbound infrastructure adapters.

use std::future::Future;

use entity_access::domain::models::{
    EditAccessLevel, EntityAccessReceipt, OwnerAccessLevel, ViewAccessLevel,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::ContentType;
use model::folder::{UploadFolderRequest, UploadFolderResponseData, UploadFolderWithIdsResponse};
use model::item::{Item, ItemWithUserAccessLevel};
use model::project::request::{CreateProjectRequest, PatchProjectRequestV2};
use model::project::response::GetProjectResponseData;
use model::project::{
    BasicProject, PendingProject, Project, ProjectPreview, ProjectPreviewV2,
    ProjectWithUploadRequest,
};
use models_bulk_upload::{
    BulkUploadRequest, BulkUploadRequestDocuments, UploadExtractFolderRequest,
    UploadExtractFolderResponseData,
};
use models_permissions::share_permission::SharePermissionV2;
use models_permissions::share_permission::access_level::AccessLevel;
use s3_key::BulkUploadStagingKey;
use uuid::Uuid;

use super::models::{
    CreateProjectArgs, EditProjectArgs, MarkedUploadedTree, MutatedProject, ProjectError,
    PurgedProjectTree, RevertDeleteResult, SoftDeleteResult, UploadFolderRepoArgs,
};

/// Repository for reading project data from persistent storage.
///
/// SQL and transaction details belong in the outbound adapter implementing
/// this trait.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait ProjectRepo: Send + Sync + 'static {
    /// Error returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Get a basic project row, including soft-deleted projects.
    fn get_basic_project(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<Option<BasicProject>, Self::Err>> + Send;

    /// Get a full, non-deleted project row.
    fn get_project_by_id(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<Option<Project>, Self::Err>> + Send;

    /// List non-deleted, uploaded projects in the user's view history.
    fn get_projects_for_user(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<Project>, Self::Err>> + Send;

    /// List non-deleted, pending root projects owned by the user.
    fn get_pending_root_projects(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<ProjectWithUploadRequest>, Self::Err>> + Send;

    /// Get depth-one project, document, and chat children in display order.
    fn get_project_children(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<Vec<Item>, Self::Err>> + Send;

    /// Get the project's share permission configuration.
    fn get_project_share_permission(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<SharePermissionV2, Self::Err>> + Send;

    /// Get previews for the supplied project identifiers.
    fn batch_get_project_preview(
        &self,
        project_ids: &[String],
    ) -> impl Future<Output = Result<Vec<ProjectPreviewV2>, Self::Err>> + Send;

    /// Atomically create a project and its permission, history, and owner-access rows.
    fn create_project(
        &self,
        args: CreateProjectArgs,
    ) -> impl Future<Output = Result<MutatedProject, Self::Err>> + Send;

    /// Edit project fields and optional sharing configuration atomically.
    fn edit_project(
        &self,
        args: EditProjectArgs,
    ) -> impl Future<Output = Result<MutatedProject, Self::Err>> + Send;

    /// Return whether the proposed parent is inside the project's subtree.
    fn is_project_recursively_nested(
        &self,
        project_id: &str,
        parent_id: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Soft-delete a project and all of its active descendants.
    fn soft_delete_project(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<SoftDeleteResult, Self::Err>> + Send;

    /// Permanently purge an already-soft-deleted project subtree and its child data.
    fn purge_deleted_project_tree(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<PurgedProjectTree, Self::Err>> + Send;

    /// Restore a deleted project subtree and the owners' history rows.
    fn revert_delete_project(
        &self,
        project_id: &str,
        previous_parent_id: Option<String>,
    ) -> impl Future<Output = Result<RevertDeleteResult, Self::Err>> + Send;

    /// Create and commit a pending project tree with empty documents.
    fn upload_folder(
        &self,
        args: UploadFolderRepoArgs,
    ) -> impl Future<Output = Result<UploadFolderWithIdsResponse, Self::Err>> + Send;

    /// Delete a committed upload tree as compensation for later failures.
    fn delete_uploaded_tree(
        &self,
        project_ids: &[String],
        document_ids: &[String],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Recursively finalize the uploaded state of a project tree.
    fn mark_projects_uploaded(
        &self,
        root_project_id: &str,
    ) -> impl Future<Output = Result<MarkedUploadedTree, Self::Err>> + Send;

    /// Update the project's modified timestamp.
    fn update_project_modified(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Port for creating and inspecting bulk-upload requests.
pub trait BulkUploadRequestPort: Send + Sync + 'static {
    /// Create a bulk-upload request.
    fn create_bulk_upload_request(
        &self,
        request_id: Uuid,
        user_id: &str,
        name: Option<&str>,
        parent_id: Option<&str>,
    ) -> impl Future<Output = anyhow::Result<BulkUploadRequest>> + Send;

    /// Get document statuses for a bulk-upload request.
    fn get_bulk_upload_document_statuses(
        &self,
        upload_request_id: &str,
    ) -> impl Future<Output = anyhow::Result<BulkUploadRequestDocuments>> + Send;
}

/// Port for generating project-upload destinations.
pub trait ProjectUploadUrlPort: Send + Sync + 'static {
    /// Generate a presigned URL for a bulk-upload archive.
    fn put_upload_zip_staging_presigned_url(
        &self,
        key: BulkUploadStagingKey,
        sha: String,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Generate a presigned URL for document storage.
    fn put_document_storage_presigned_url(
        &self,
        key: String,
        sha: String,
        content_type: ContentType,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Generate a presigned URL for DOCX staging.
    fn put_docx_upload_presigned_url(
        &self,
        key: String,
        sha: String,
        content_type: ContentType,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Get the document-storage bucket name for internal destinations.
    fn document_storage_bucket(&self) -> &str;

    /// Get the DOCX-upload bucket name for internal destinations.
    fn docx_upload_bucket(&self) -> &str;
}

/// Port for updating persisted content-hash reference counts.
pub trait ShaCounterPort: Send + Sync + 'static {
    /// Decrement each SHA reference count by the supplied amount.
    fn decrement_counts(
        &self,
        sha_counts: &[(String, i64)],
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Port for publishing project search and document-deletion work.
pub trait ProjectSearchIndexer: Send + Sync + 'static {
    /// Enqueue projects for indexing.
    fn upsert_projects(
        &self,
        project_ids: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Remove projects from the search index.
    fn remove_projects(
        &self,
        project_ids: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Remove chats from the search index.
    fn remove_chats(
        &self,
        chat_ids: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Remove documents from the search index.
    fn remove_documents(
        &self,
        document_ids: Vec<String>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Enqueue document deletion work as `(document_id, owner_id)` pairs.
    fn enqueue_document_deletes(
        &self,
        documents: Vec<(String, String)>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Inbound-facing service interface for project operations.
pub trait ProjectService: Send + Sync + 'static {
    /// List projects visible through the user's project history.
    fn list_projects(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<Project>, ProjectError>> + Send;

    /// List pending root projects owned by the user.
    fn list_pending_projects(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<PendingProject>, ProjectError>> + Send;

    /// Get project metadata and the caller's access level.
    fn get_project(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<GetProjectResponseData, ProjectError>> + Send;

    /// Get depth-one project content with caller-specific access attribution.
    fn get_project_content(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<Vec<ItemWithUserAccessLevel>, ProjectError>> + Send;

    /// Get project share permissions for an owner.
    fn get_project_permissions(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<SharePermissionV2, ProjectError>> + Send;

    /// Get the caller's access level from a validated receipt.
    fn get_project_access_level(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<AccessLevel, ProjectError>> + Send;

    /// Create a project, optionally beneath an authorized parent.
    fn create_project(
        &self,
        actor: MacroUserIdStr<'static>,
        args: CreateProjectRequest,
    ) -> impl Future<Output = Result<Project, ProjectError>> + Send;

    /// Edit project metadata and sharing settings.
    fn edit_project(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        project: BasicProject,
        args: PatchProjectRequestV2,
    ) -> impl Future<Output = Result<(), ProjectError>> + Send;

    /// Soft-delete a project subtree.
    fn soft_delete_project(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project: BasicProject,
        actor_user_id: String,
    ) -> impl Future<Output = Result<SoftDeleteResult, ProjectError>> + Send;

    /// Permanently purge a soft-deleted project subtree.
    fn permanently_delete_project(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project: BasicProject,
    ) -> impl Future<Output = Result<(), ProjectError>> + Send;

    /// Restore a soft-deleted project subtree.
    fn revert_delete_project(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        project: BasicProject,
    ) -> impl Future<Output = Result<(), ProjectError>> + Send;

    /// Create a pending project tree and its upload destinations.
    fn upload_folder(
        &self,
        actor: MacroUserIdStr<'static>,
        internal: bool,
        args: UploadFolderRequest,
    ) -> impl Future<Output = Result<UploadFolderResponseData, ProjectError>> + Send;

    /// Create a tracked request for extracting an uploaded archive.
    fn create_upload_extract_request(
        &self,
        actor: MacroUserIdStr<'static>,
        args: UploadExtractFolderRequest,
    ) -> impl Future<Output = Result<UploadExtractFolderResponseData, ProjectError>> + Send;

    /// Finalize the uploaded state of a project tree.
    fn mark_projects_uploaded(
        &self,
        root_project_id: &str,
    ) -> impl Future<Output = Result<Vec<String>, ProjectError>> + Send;

    /// Get project previews without applying per-project access filtering.
    fn get_batch_preview(
        &self,
        actor: Option<MacroUserIdStr<'static>>,
        project_ids: Vec<String>,
    ) -> impl Future<Output = Result<Vec<ProjectPreview>, ProjectError>> + Send;

    /// Get basic project metadata without performing access checks.
    fn internal_get_basic_project(
        &self,
        project_id: &str,
    ) -> impl Future<Output = Result<BasicProject, ProjectError>> + Send;
}
