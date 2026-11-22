//! Outbound adapter for initializing markdown content through lexical-service and sync-service.

/// Canonical blank-markdown Loro "golden" snapshot.
const MARKDOWN_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../static_assets/markdown-golden.1.bin");

use std::future::Future;
use std::time::Duration;

use lexical_client::LexicalClient;
use lexical_client::notion::{
    NotionSnapshotLinks, NotionSnapshotPage, NotionSnapshotRequest, NotionSnapshotUser,
};
use lexical_client::parse_markdown::MarkdownSnapshotOptions;
use sync_service_client::{SyncServiceClient, initialize::SnapshotAlreadyExists};
use tokio_retry::{RetryIf, strategy::FixedInterval};

use crate::domain::models::DocumentError;
use crate::domain::notion_markdown::NotionMarkdown;
use crate::domain::ports::markdown::{
    LexicalSnapshotPort, MarkdownInitializationOptions, MarkdownInitializationPort,
    MarkdownSnapshot, SyncInitializeSnapshotPort,
};

impl LexicalSnapshotPort for LexicalClient {
    async fn markdown_to_loro_snapshot(
        &self,
        markdown: &str,
        options: MarkdownInitializationOptions,
    ) -> anyhow::Result<Vec<u8>> {
        LexicalClient::markdown_to_loro_snapshot(
            self,
            markdown,
            MarkdownSnapshotOptions {
                initial_pins: options.initial_pins,
            },
        )
        .await
    }

    async fn notion_to_loro_snapshot(
        &self,
        notion: &NotionMarkdown,
    ) -> anyhow::Result<MarkdownSnapshot> {
        let request = NotionSnapshotRequest {
            markdown: &notion.markdown,
            links: NotionSnapshotLinks {
                pages: notion
                    .pages
                    .iter()
                    .map(|(notion_id, page)| {
                        let page = NotionSnapshotPage {
                            document_id: page.document_id.to_string(),
                            name: page.name.clone(),
                        };
                        (notion_id.clone(), page)
                    })
                    .collect(),
                users: notion
                    .users
                    .iter()
                    .map(|(notion_id, user)| {
                        let user = NotionSnapshotUser {
                            user_id: user.user_id.clone(),
                            email: user.email.clone(),
                        };
                        (notion_id.clone(), user)
                    })
                    .collect(),
            },
        };
        let converted = LexicalClient::notion_to_loro_snapshot(self, &request).await?;
        Ok(MarkdownSnapshot {
            snapshot: converted.snapshot,
            markdown: converted.markdown,
        })
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
/// It returns only once sync-service holds the snapshot, so a failed write
/// fails the creation (which then removes the document) instead of leaving a
/// document whose body never loads.
///
/// Generic over the two port traits so tests can substitute mocks; defaults
/// preserve the production wiring with the real HTTP clients.
#[derive(Clone)]
pub struct LexicalSyncMarkdownInitializer<L = LexicalClient, S = SyncServiceClient> {
    lexical_client: L,
    sync_service_client: S,
}

impl<L, S> LexicalSyncMarkdownInitializer<L, S> {
    /// Construct an initializer that returns once sync-service holds the snapshot.
    pub fn new(lexical_client: L, sync_service_client: S) -> Self {
        Self {
            lexical_client,
            sync_service_client,
        }
    }
}

impl<L, S> MarkdownInitializationPort for LexicalSyncMarkdownInitializer<L, S>
where
    L: LexicalSnapshotPort,
    S: SyncInitializeSnapshotPort,
{
    #[tracing::instrument(skip(self, markdown), err)]
    async fn initialize_existing_markdown(
        &self,
        document_id: &str,
        markdown: &str,
        options: MarkdownInitializationOptions,
    ) -> Result<Vec<u8>, DocumentError> {
        let loro_snapshot: Vec<u8> =
            if markdown.is_empty() && options == MarkdownInitializationOptions::default() {
                MARKDOWN_GOLDEN_SNAPSHOT.into()
            } else {
                self.lexical_client
                    .markdown_to_loro_snapshot(markdown, options)
                    .await
                    .map_err(DocumentError::Internal)?
            };

        initialize_with_retry(&self.sync_service_client, document_id, &loro_snapshot)
            .await
            .map_err(DocumentError::Internal)?;
        Ok(loro_snapshot)
    }

    #[tracing::instrument(skip(self, notion), fields(markdown_bytes = notion.markdown.len()), err)]
    async fn initialize_existing_notion(
        &self,
        document_id: &str,
        notion: &NotionMarkdown,
    ) -> Result<MarkdownSnapshot, DocumentError> {
        let converted = self
            .lexical_client
            .notion_to_loro_snapshot(notion)
            .await
            .map_err(DocumentError::Internal)?;
        initialize_with_retry(&self.sync_service_client, document_id, &converted.snapshot)
            .await
            .map_err(DocumentError::Internal)?;
        Ok(converted)
    }
}

/// POST the snapshot to sync-service, retrying transient failures. A 409 on
/// the first attempt is returned as-is: retrying cannot change it, and callers
/// decide whether an existing snapshot is acceptable. A 409 on a retry means an
/// earlier attempt stored this snapshot after its response was lost (the
/// sync-service front worker answers 408 when the durable object is slow, but
/// the object still finishes the write), so it counts as success.
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
                match &result {
                    Err(error) if attempt > 1 && is_snapshot_already_exists(error) => {
                        tracing::info!(
                            attempt,
                            "sync service already holds the snapshot an earlier attempt sent"
                        );
                        return Ok(());
                    }
                    Err(error) if attempt < MAX_ATTEMPTS && !is_snapshot_already_exists(error) => {
                        tracing::warn!(error=?error, attempt, "failed to initialize sync service from snapshot, retrying in 1s");
                    }
                    _ => {}
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
            .initialize_existing_markdown("doc1", "", MarkdownInitializationOptions::default())
            .await
            .unwrap();
        assert_eq!(snapshot, MARKDOWN_GOLDEN_SNAPSHOT);
    }

    #[tokio::test]
    async fn empty_markdown_with_pins_uses_lexical_canonical_snapshot() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();
        lexical
            .expect_markdown_to_loro_snapshot()
            .withf(|markdown, pins| {
                markdown.is_empty() && pins.initial_pins == Some(vec!["field".to_string()])
            })
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(vec![4, 2]) }));
        sync.expect_initialize_from_snapshot()
            .withf(|id, snapshot| id == "task" && snapshot == [4, 2])
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let pins = vec!["field".to_string()];
        assert_eq!(
            initializer
                .initialize_existing_markdown(
                    "task",
                    "",
                    MarkdownInitializationOptions {
                        initial_pins: Some(pins)
                    }
                )
                .await
                .unwrap(),
            [4, 2]
        );
    }

    #[tokio::test]
    async fn empty_markdown_with_explicit_empty_pins_uses_lexical() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();
        lexical
            .expect_markdown_to_loro_snapshot()
            .withf(|markdown, options| markdown.is_empty() && options.initial_pins == Some(vec![]))
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(vec![4, 3]) }));
        sync.expect_initialize_from_snapshot()
            .withf(|id, snapshot| id == "task" && snapshot == [4, 3])
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let snapshot = initializer
            .initialize_existing_markdown(
                "task",
                "",
                MarkdownInitializationOptions {
                    initial_pins: Some(vec![]),
                },
            )
            .await
            .unwrap();
        assert_eq!(snapshot, [4, 3]);
    }

    #[tokio::test]
    async fn non_empty_markdown_calls_lexical_then_sync() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();

        lexical
            .expect_markdown_to_loro_snapshot()
            .withf(|m, pins| m == "# hi" && pins.initial_pins.is_none())
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .withf(|id, bytes| id == "doc2" && bytes == [1, 2, 3])
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let snapshot = initializer
            .initialize_existing_markdown("doc2", "# hi", MarkdownInitializationOptions::default())
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
            .returning(|_, _| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .times(3)
            .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("sync-service unavailable")) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let error = initializer
            .initialize_existing_markdown("doc3", "# hi", MarkdownInitializationOptions::default())
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
            .returning(|_, _| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .times(1)
            .returning(|_, _| Box::pin(async { Err(SnapshotAlreadyExists.into()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let error = initializer
            .initialize_existing_markdown("doc4", "# hi", MarkdownInitializationOptions::default())
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "snapshot already exists");
    }

    #[tokio::test(start_paused = true)]
    async fn an_existing_snapshot_on_a_retry_is_the_earlier_attempts_write() {
        let mut lexical = MockLexicalSnapshotPort::new();
        let mut sync = MockSyncInitializeSnapshotPort::new();
        let mut sequence = mockall::Sequence::new();

        lexical
            .expect_markdown_to_loro_snapshot()
            .times(1)
            .returning(|_, _| Box::pin(async { Ok(vec![1, 2, 3]) }));
        sync.expect_initialize_from_snapshot()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(|_, _| Box::pin(async { Err(anyhow::anyhow!("Request Timeout")) }));
        sync.expect_initialize_from_snapshot()
            .times(1)
            .in_sequence(&mut sequence)
            .returning(|_, _| Box::pin(async { Err(SnapshotAlreadyExists.into()) }));

        let initializer = LexicalSyncMarkdownInitializer::new(lexical, sync);
        let snapshot = initializer
            .initialize_existing_markdown("doc5", "# hi", MarkdownInitializationOptions::default())
            .await
            .unwrap();
        assert_eq!(snapshot, [1, 2, 3]);
    }
}
