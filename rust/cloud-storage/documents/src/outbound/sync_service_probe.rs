//! Sync-service adapter for markdown lifecycle backfill.

use crate::domain::markdown_backfill::SyncServiceProbe;

/// Implements [`SyncServiceProbe`] by delegating to the HTTP sync-service client.
impl SyncServiceProbe for sync_service_client::SyncServiceClient {
    #[tracing::instrument(err, skip(self))]
    async fn exists(&self, document_id: &str) -> anyhow::Result<bool> {
        sync_service_client::SyncServiceClient::exists(self, document_id).await
    }
}
