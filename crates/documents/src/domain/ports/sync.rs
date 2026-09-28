//! Collaborative document storage operations required by the document service.

use std::future::Future;

use model::sync_service::SyncServiceVersionID;

/// Durable collaborative content, independent of the document's editor schema.
#[cfg_attr(test, mockall::automock)]
pub trait DocumentSyncPort: Send + Sync + 'static {
    /// Initialize a native spreadsheet with its canonical empty workbook snapshot.
    fn initialize_spreadsheet(
        &self,
        document_id: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Whether durable collaborative content exists for a document.
    fn exists(&self, document_id: &str) -> impl Future<Output = anyhow::Result<bool>> + Send;

    /// Duplicate collaborative content, optionally at a historical version.
    fn copy_document(
        &self,
        original_document_id: &str,
        target_document_id: &str,
        version_id: Option<SyncServiceVersionID>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}
