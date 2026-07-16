//! Concrete project service composition.

use entity_access_management::domain::ports::EntityAccessManagementService;
use uuid::Uuid;

use super::ports::{
    BulkUploadRequestPort, ProjectRepo, ProjectSearchIndexer, ProjectUploadUrlPort, ShaCounterPort,
};

/// Concrete project service backed by repository and external-system ports.
pub struct ProjectServiceImpl<R, U, D, Sha, Eam, Idx>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
{
    /// Project repository.
    pub repo: R,
    /// Upload destination provider.
    pub upload_url_service: U,
    /// Bulk-upload request provider.
    pub bulk_upload_service: D,
    /// Content-hash reference counter.
    pub sha_counter: Sha,
    /// Entity-access inheritance manager.
    pub entity_access_management_service: Eam,
    /// Search and deletion queue publisher.
    pub search_indexer: Idx,
    /// Optional deterministic upload request ID used by local development.
    pub fixed_upload_request_id: Option<Uuid>,
}

impl<R, U, D, Sha, Eam, Idx> ProjectServiceImpl<R, U, D, Sha, Eam, Idx>
where
    R: ProjectRepo,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
{
    /// Create a project service from its repository and external-system ports.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        repo: R,
        upload_url_service: U,
        bulk_upload_service: D,
        sha_counter: Sha,
        entity_access_management_service: Eam,
        search_indexer: Idx,
        fixed_upload_request_id: Option<Uuid>,
    ) -> Self {
        Self {
            repo,
            upload_url_service,
            bulk_upload_service,
            sha_counter,
            entity_access_management_service,
            search_indexer,
            fixed_upload_request_id,
        }
    }
}
