//! Outbound adapter for initializing markdown content through lexical-service and sync-service.

/// Canonical blank-markdown Loro "golden" snapshot.
const MARKDOWN_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../static_assets/markdown-golden.1.bin");

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use lexical_client::LexicalClient;
use sync_service_client::SyncServiceClient;
use tokio_retry::{Retry, strategy::FixedInterval};

use crate::domain::models::DocumentError;
use crate::domain::ports::markdown::{
    LexicalSnapshotPort, MarkdownInitializationPort, SyncInitializeSnapshotPort,
};

impl LexicalSnapshotPort for LexicalClient {
    fn markdown_to_loro_snapshot(
        &self,
        markdown: &str,
    ) -> impl Future<Output = anyhow::Result<Vec<u8>>> + Send {
        LexicalClient::markdown_to_loro_snapshot(self, markdown)
    }
}

impl SyncInitializeSnapshotPort for SyncServiceClient {
    fn initialize_from_snapshot(
        &self,
        document_id: &str,
        snapshot: &[u8],
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        SyncServiceClient::initialize_from_snapshot(self, document_id, snapshot)
    }
}

/// Markdown initializer backed by lexical-service and sync-service clients.
///
/// Generic over the two port traits so tests can substitute mocks; defaults
/// preserve the production wiring with the real HTTP clients.
#[derive(Clone)]
pub struct LexicalSyncMarkdownInitializer<L = LexicalClient, S = SyncServiceClient> {
    lexical_client: L,
    sync_service_client: Arc<S>,
}

impl<L, S> LexicalSyncMarkdownInitializer<L, S> {
    /// Construct a lexical/sync-backed markdown initializer.
    pub fn new(lexical_client: L, sync_service_client: S) -> Self {
        Self {
            lexical_client,
            sync_service_client: Arc::new(sync_service_client),
        }
    }
}

impl<L, S> MarkdownInitializationPort for LexicalSyncMarkdownInitializer<L, S>
where
    L: LexicalSnapshotPort,
    S: SyncInitializeSnapshotPort + 'static,
{
    #[tracing::instrument(skip(self, markdown), err)]
    async fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
    ) -> Result<(), DocumentError> {
        let loro_snapshot = if markdown.is_empty() {
            MARKDOWN_GOLDEN_SNAPSHOT.into()
        } else {
            self.lexical_client
                .markdown_to_loro_snapshot(markdown)
                .await
                .map_err(DocumentError::Internal)?
        };

        let sync_service_client = self.sync_service_client.clone();
        let document_id = document_id.to_owned();
        tokio::spawn(async move {
            const MAX_ATTEMPTS: usize = 3;
            const RETRY_DELAY: Duration = Duration::from_secs(1);

            let loro_snapshot: Arc<[u8]> = loro_snapshot.into();
            let mut attempt = 0usize;
            let result = Retry::start(
                FixedInterval::new(RETRY_DELAY).take(MAX_ATTEMPTS - 1),
                || {
                    attempt += 1;
                    let sync_service_client = Arc::clone(&sync_service_client);
                    let document_id = document_id.clone();
                    let loro_snapshot = Arc::clone(&loro_snapshot);
                    async move {
                        let result = sync_service_client
                            .initialize_from_snapshot(&document_id, &loro_snapshot)
                            .await;
                        if let Err(error) = &result
                            && attempt < MAX_ATTEMPTS
                        {
                            tracing::warn!(error=?error, attempt, "failed to initialize sync service from snapshot, retrying in 1s");
                        }
                        result
                    }
                },
            )
            .await;

            if let Err(error) = result {
                tracing::error!(error=?error, "failed to initialize sync service from snapshot after {MAX_ATTEMPTS} attempts");
            }
        });

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ports::markdown::{MockLexicalSnapshotPort, MockSyncInitializeSnapshotPort};

    #[tokio::test]
    async fn empty_markdown_skips_lexical_and_fires_sync_with_golden() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();

        lexical.expect_markdown_to_loro_snapshot().times(0);
        sync.expect_initialize_from_snapshot()
            .withf(|id, bytes| id == "doc1" && bytes == MARKDOWN_GOLDEN_SNAPSHOT)
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        initializer
            .initialize_existing_markdown("doc1", "")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn non_empty_markdown_calls_lexical_then_sync() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();

        lexical
            .expect_markdown_to_loro_snapshot()
            .withf(|m| m == "# hi")
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .withf(|id, bytes| id == "doc2" && bytes == [1, 2, 3])
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        initializer
            .initialize_existing_markdown("doc2", "# hi")
            .await
            .unwrap();
    }
}
