//! Outbound adapter for initializing markdown content through lexical-service and sync-service.

/// Canonical blank-markdown Loro "golden" snapshot.
const MARKDOWN_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../static_assets/markdown-golden.1.bin");

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use lexical_client::LexicalClient;
use sync_service_client::{SyncServiceClient, initialize::SnapshotAlreadyExists};
use tokio_retry::{RetryIf, strategy::FixedInterval};

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

/// When the sync-service snapshot write finishes relative to the caller.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SyncInitialization {
    /// Return only after sync-service holds the snapshot.
    Awaited,
    /// Return immediately and write the snapshot in a background task. Only
    /// sound in a long-lived process: a Lambda freezes, and a CLI exits, with
    /// the task still pending, leaving a document that never loads.
    Detached,
}

/// Markdown initializer backed by lexical-service and sync-service clients.
///
/// Generic over the two port traits so tests can substitute mocks; defaults
/// preserve the production wiring with the real HTTP clients.
#[derive(Clone)]
pub struct LexicalSyncMarkdownInitializer<L = LexicalClient, S = SyncServiceClient> {
    lexical_client: L,
    sync_service_client: Arc<S>,
    sync_initialization: SyncInitialization,
}

impl<L, S> LexicalSyncMarkdownInitializer<L, S> {
    /// Construct an initializer that returns once sync-service holds the snapshot.
    pub fn new(lexical_client: L, sync_service_client: S) -> Self {
        Self {
            lexical_client,
            sync_service_client: Arc::new(sync_service_client),
            sync_initialization: SyncInitialization::Awaited,
        }
    }

    /// Construct an initializer that writes the snapshot in a background task,
    /// so optimistic document creation can return before sync-service does.
    /// Only for long-lived servers.
    pub fn detached(lexical_client: L, sync_service_client: S) -> Self {
        Self {
            sync_initialization: SyncInitialization::Detached,
            ..Self::new(lexical_client, sync_service_client)
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
    ) -> Result<Vec<u8>, DocumentError> {
        let loro_snapshot: Vec<u8> = if markdown.is_empty() {
            MARKDOWN_GOLDEN_SNAPSHOT.into()
        } else {
            self.lexical_client
                .markdown_to_loro_snapshot(markdown)
                .await
                .map_err(DocumentError::Internal)?
        };

        match self.sync_initialization {
            SyncInitialization::Awaited => {
                initialize_with_retry(&*self.sync_service_client, document_id, &loro_snapshot)
                    .await
                    .map_err(DocumentError::Internal)?;
            }
            SyncInitialization::Detached => {
                let sync_service_client = Arc::clone(&self.sync_service_client);
                let document_id = document_id.to_owned();
                let snapshot = loro_snapshot.clone();
                tokio::spawn(async move {
                    if let Err(error) =
                        initialize_with_retry(&*sync_service_client, &document_id, &snapshot).await
                    {
                        tracing::error!(error=?error, %document_id, "failed to initialize sync service from snapshot");
                    }
                });
            }
        }

        Ok(loro_snapshot)
    }
}

/// POST the snapshot to sync-service, retrying transient failures. A 409 is
/// returned as-is: retrying cannot change it, and callers decide whether an
/// existing snapshot is acceptable.
async fn initialize_with_retry<S: SyncInitializeSnapshotPort>(
    sync_service_client: &S,
    document_id: &str,
    snapshot: &[u8],
) -> anyhow::Result<()> {
    const MAX_ATTEMPTS: usize = 3;
    const RETRY_DELAY: Duration = Duration::from_secs(1);

    let mut attempt = 0usize;
    RetryIf::start(
        FixedInterval::new(RETRY_DELAY).take(MAX_ATTEMPTS - 1),
        || {
            attempt += 1;
            async move {
                let result = sync_service_client
                    .initialize_from_snapshot(document_id, snapshot)
                    .await;
                if let Err(error) = &result
                    && attempt < MAX_ATTEMPTS
                    && !is_snapshot_already_exists(error)
                {
                    tracing::warn!(error=?error, attempt, "failed to initialize sync service from snapshot, retrying in 1s");
                }
                result
            }
        },
        |error: &anyhow::Error| !is_snapshot_already_exists(error),
    )
    .await
}

fn is_snapshot_already_exists(error: &anyhow::Error) -> bool {
    error.is::<SnapshotAlreadyExists>()
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
        let snapshot = initializer
            .initialize_existing_markdown("doc1", "")
            .await
            .unwrap();
        assert_eq!(snapshot, MARKDOWN_GOLDEN_SNAPSHOT);
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
        let snapshot = initializer
            .initialize_existing_markdown("doc2", "# hi")
            .await
            .unwrap();
        assert_eq!(snapshot, [1, 2, 3]);
    }

    #[tokio::test(start_paused = true)]
    async fn awaited_returns_sync_failure_after_retrying() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();

        lexical
            .expect_markdown_to_loro_snapshot()
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .times(3)
            .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("sync-service unavailable")) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let error = initializer
            .initialize_existing_markdown("doc3", "# hi")
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "sync-service unavailable");
    }

    #[tokio::test(start_paused = true)]
    async fn awaited_does_not_retry_an_existing_snapshot() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();

        lexical
            .expect_markdown_to_loro_snapshot()
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .times(1)
            .returning(|_, _| Box::pin(async { Err(SnapshotAlreadyExists.into()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let error = initializer
            .initialize_existing_markdown("doc4", "# hi")
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "snapshot already exists");
    }

    #[tokio::test(start_paused = true)]
    async fn detached_returns_the_snapshot_without_waiting_for_sync() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();

        lexical
            .expect_markdown_to_loro_snapshot()
            .times(1)
            .returning(|_| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("sync-service unavailable")) }));

        let initializer = LexicalSyncMarkdownInitializer::detached(lexical, sync);
        let snapshot = initializer
            .initialize_existing_markdown("doc5", "# hi")
            .await
            .unwrap();
        assert_eq!(snapshot, [1, 2, 3]);
    }
}
