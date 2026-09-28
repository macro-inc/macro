//! Sync-service implementation of the collaborative document storage port.

use model::sync_service::SyncServiceVersionID;
use sync_service_client::SyncServiceClient;

use crate::domain::ports::sync::DocumentSyncPort;

/// A Loro snapshot containing only `spreadsheetMeta.formatVersion = 1`.
const SPREADSHEET_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../static_assets/spreadsheet-golden.1.bin");

/// A Loro snapshot containing only `gameMeta.formatVersion = 1`. The first
/// editor to open the room records which game it hosts.
const GAME_GOLDEN_SNAPSHOT: &[u8] = include_bytes!("../../../../static_assets/game-golden.1.bin");

impl DocumentSyncPort for SyncServiceClient {
    async fn initialize_spreadsheet(&self, document_id: &str) -> anyhow::Result<()> {
        self.initialize_from_snapshot(document_id, SPREADSHEET_GOLDEN_SNAPSHOT)
            .await
    }

    async fn initialize_game(&self, document_id: &str) -> anyhow::Result<()> {
        self.initialize_from_snapshot(document_id, GAME_GOLDEN_SNAPSHOT)
            .await
    }

    async fn exists(&self, document_id: &str) -> anyhow::Result<bool> {
        SyncServiceClient::exists(self, document_id).await
    }

    async fn copy_document(
        &self,
        original_document_id: &str,
        target_document_id: &str,
        version_id: Option<SyncServiceVersionID>,
    ) -> anyhow::Result<()> {
        SyncServiceClient::copy_document(self, original_document_id, target_document_id, version_id)
            .await
    }
}
