//! Deferred cleanup preserves bytes referenced by drafts and in-flight revisions.
use super::draft_attachments::AttachmentError;
use std::future::Future;
use uuid::Uuid;

pub struct ObjectCleanupLease {
    pub key: String,
    pub lease_id: Uuid,
}
pub trait DraftObjectCleanupRepository: Send + Sync + 'static {
    /// Claims only unreferenced keys after upload URLs have expired. Rechecks
    /// current payloads, frozen checkpoints and every active claimed revision.
    fn claim_object_cleanup(
        &self,
        lease_id: Uuid,
    ) -> impl Future<Output = Result<Option<ObjectCleanupLease>, AttachmentError>> + Send;
    fn finish_object_cleanup(
        &self,
        lease: &ObjectCleanupLease,
    ) -> impl Future<Output = Result<(), AttachmentError>> + Send;
}
pub trait DraftObjectDeletion: Send + Sync + 'static {
    fn delete_object(&self, key: &str) -> impl Future<Output = Result<(), AttachmentError>> + Send;
}
pub struct DraftObjectCleanup<R, S> {
    pub repository: R,
    pub storage: S,
}
impl<R: DraftObjectCleanupRepository, S: DraftObjectDeletion> DraftObjectCleanup<R, S> {
    pub async fn execute_once(&self) -> Result<bool, AttachmentError> {
        let Some(lease) = self
            .repository
            .claim_object_cleanup(macro_uuid::generate_uuid_v7())
            .await?
        else {
            return Ok(false);
        };
        self.storage.delete_object(&lease.key).await?;
        self.repository.finish_object_cleanup(&lease).await?;
        Ok(true)
    }
}
