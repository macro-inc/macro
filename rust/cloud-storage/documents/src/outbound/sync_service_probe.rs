//! Sync-service adapter for markdown lifecycle backfill.

use crate::domain::markdown_backfill::SyncServiceProbe;

impl SyncServiceProbe for sync_service_client::SyncServiceClient {
    async fn exists(&self, document_id: &str) -> anyhow::Result<bool> {
        sync_service_client::SyncServiceClient::exists(self, document_id).await
    }
}
