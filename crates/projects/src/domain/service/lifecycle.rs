//! Physical lifecycle reads for trusted domain integrations.
use super::*;
use crate::domain::ports::ProjectLifecycleReads;

impl<R, U, D, Sha, Eam, Idx, Unf, B> ProjectLifecycleReads
    for ProjectServiceImpl<R, U, D, Sha, Eam, Idx, Unf, B>
where
    R: ProjectRepo + ProjectLifecycleReads,
    U: ProjectUploadUrlPort,
    D: BulkUploadRequestPort,
    Sha: ShaCounterPort,
    Eam: EntityAccessManagementService,
    Idx: ProjectSearchIndexer,
    Unf: FiledItemsUnfiler,
    B: MacroEventBroker,
{
    #[tracing::instrument(skip(self), err)]
    async fn project_is_live(&self, id: Uuid) -> anyhow::Result<bool> {
        self.repo.project_is_live(id).await
    }
}
