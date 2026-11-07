//! Physical lifecycle facts for trusted domain integrations.
use super::*;
use crate::domain::ports::DocumentLifecycleReads;

impl<R, U, T, C, Eam, F, B, S> DocumentLifecycleReads
    for DocumentServiceImpl<R, U, T, C, Eam, F, B, S>
where
    R: DocumentRepo + DocumentLifecycleReads,
    U: PresignedUploadUrlPort,
    T: TaskPropertiesPort,
    C: ConnectionService,
    Eam: EntityAccessManagementService,
    F: ForeignEntityService,
    B: MacroEventBroker,
    S: DocumentSyncPort,
{
    #[tracing::instrument(skip(self), err)]
    async fn document_is_live(&self, id: Uuid) -> anyhow::Result<bool> {
        self.repo.document_is_live(id).await
    }
}
