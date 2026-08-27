//! Sync-service session initializer backed by lexical-service and
//! sync-service HTTP clients.
//!
//! Mirrors `crates/documents/src/outbound/markdown_init.rs`, with one
//! deliberate difference: initialization here is awaited by the caller (with
//! the same bounded retry) instead of being spawned fire-and-forget, so
//! surface creation can report `ready` truthfully.

use std::time::Duration;

use lexical_client::LexicalClient;
use sync_service_client::SyncServiceClient;
use tokio_retry::{Retry, strategy::FixedInterval};

use crate::domain::models::CollabSurfaceError;
use crate::domain::ports::SurfaceInitializer;

/// Canonical blank-markdown Loro "golden" snapshot — the same bytes the
/// documents crate seeds empty markdown documents with.
const MARKDOWN_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../static_assets/markdown-golden.1.bin");

const MAX_ATTEMPTS: usize = 3;
const RETRY_DELAY: Duration = Duration::from_secs(1);

/// [`SurfaceInitializer`] over the real lexical-service and sync-service
/// clients.
pub struct LexicalSyncSurfaceInitializer {
    lexical_client: LexicalClient,
    sync_service_client: SyncServiceClient,
}

impl LexicalSyncSurfaceInitializer {
    /// Build the initializer from the shared HTTP clients.
    pub fn new(lexical_client: LexicalClient, sync_service_client: SyncServiceClient) -> Self {
        Self {
            lexical_client,
            sync_service_client,
        }
    }
}

impl SurfaceInitializer for LexicalSyncSurfaceInitializer {
    #[tracing::instrument(err, skip(self, markdown))]
    async fn initialize(&self, surface_id: &str, markdown: &str) -> Result<(), CollabSurfaceError> {
        let snapshot: Vec<u8> = if markdown.is_empty() {
            MARKDOWN_GOLDEN_SNAPSHOT.to_vec()
        } else {
            self.lexical_client
                .markdown_to_loro_snapshot(markdown)
                .await
                .map_err(|e| {
                    CollabSurfaceError::Internal(
                        rootcause::report!("failed to convert markdown to loro snapshot: {e:?}")
                            .into_dynamic(),
                    )
                })?
        };

        let result = Retry::start(
            FixedInterval::new(RETRY_DELAY).take(MAX_ATTEMPTS - 1),
            || {
                self.sync_service_client
                    .initialize_from_snapshot(surface_id, &snapshot)
            },
        )
        .await;

        match result {
            Ok(()) => Ok(()),
            // Initialization is one-shot on the sync-service side, so "snapshot
            // already exists" means an earlier or concurrent ensure won the
            // init — success for our purposes. This is what makes `ensure`
            // idempotent across retries and races.
            Err(e) if e.to_string().contains("snapshot already exists") => {
                tracing::debug!(
                    surface_id = surface_id,
                    "sync-service session already initialized; treating as success"
                );
                Ok(())
            }
            Err(e) => Err(CollabSurfaceError::Internal(
                rootcause::report!("failed to initialize sync-service session: {e:?}")
                    .into_dynamic(),
            )),
        }
    }
}
