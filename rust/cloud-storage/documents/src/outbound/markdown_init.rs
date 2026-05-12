//! Outbound adapter for initializing markdown content through lexical-service and sync-service.

use lexical_client::LexicalClient;
use sync_service_client::SyncServiceClient;

use crate::domain::models::DocumentError;
use crate::domain::ports::markdown::MarkdownInitializationPort;

/// Markdown initializer backed by lexical-service and sync-service clients.
#[derive(Clone)]
pub struct LexicalSyncMarkdownInitializer {
    lexical_client: LexicalClient,
    sync_service_client: SyncServiceClient,
}

impl LexicalSyncMarkdownInitializer {
    /// Construct a lexical/sync-backed markdown initializer.
    pub fn new(lexical_client: LexicalClient, sync_service_client: SyncServiceClient) -> Self {
        Self {
            lexical_client,
            sync_service_client,
        }
    }
}

impl MarkdownInitializationPort for LexicalSyncMarkdownInitializer {
    #[tracing::instrument(skip(self, markdown), err)]
    async fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
    ) -> Result<(), DocumentError> {
        let snapshot = self
            .lexical_client
            .markdown_to_loro_snapshot(markdown)
            .await
            .map_err(DocumentError::Internal)?;

        self.sync_service_client
            .initialize_from_snapshot(document_id, &snapshot)
            .await
            .map_err(DocumentError::Internal)
    }
}
