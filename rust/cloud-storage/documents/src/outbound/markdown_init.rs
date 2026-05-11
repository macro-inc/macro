//! Outbound adapter for initializing markdown content through lexical-service and sync-service.

use lexical_client::LexicalClient;
use sync_service_client::SyncServiceClient;

use crate::domain::models::DocumentError;
use crate::domain::ports::markdown::MarkdownInitializationPort;

/// Markdown initializer backed by lexical-service and sync-service clients.
pub struct LexicalSyncMarkdownInitializer<'a> {
    lexical_client: &'a LexicalClient,
    sync_service_client: &'a SyncServiceClient,
}

impl<'a> LexicalSyncMarkdownInitializer<'a> {
    /// Construct a lexical/sync-backed markdown initializer.
    pub fn new(
        lexical_client: &'a LexicalClient,
        sync_service_client: &'a SyncServiceClient,
    ) -> Self {
        Self {
            lexical_client,
            sync_service_client,
        }
    }
}

impl MarkdownInitializationPort for LexicalSyncMarkdownInitializer<'_> {
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
