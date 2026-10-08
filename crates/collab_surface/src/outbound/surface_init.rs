//! Sync-service session initializer backed by lexical-service and
//! sync-service HTTP clients.
//!
//! Mirrors `crates/documents/src/outbound/markdown_init.rs`, with one
//! deliberate difference: initialization here is awaited by the caller (with
//! the same bounded retry) instead of being spawned fire-and-forget, so
//! surface creation can report `ready` truthfully.
//!
//! Reads and writes of a ready surface's Loro state go through sync-service's
//! signed `/document/{id}/state` and `/document/{id}/update` routes with a
//! grant the domain minted, never the internal key.

use std::time::Duration;

use lexical_client::{LexicalClient, parse_markdown::MarkdownTarget};
use sync_service_client::SyncServiceClient;
use sync_service_client::document_state::{DocumentStateError, DocumentUpdate};
use sync_service_client::initialize::SnapshotAlreadyExists;
use tokio_retry::{Retry, strategy::FixedInterval};

use macro_sync_service_jwt::DocumentPermissionToken;

use crate::domain::models::{CollabSurfaceError, SurfaceSnapshot, SurfaceUpdate};
use crate::domain::ports::SurfaceInitializer;

/// Canonical blank-markdown Loro "golden" snapshot — the same bytes the
/// documents crate seeds empty markdown documents with.
const MARKDOWN_GOLDEN_SNAPSHOT: &[u8] =
    include_bytes!("../../../../static_assets/markdown-golden.1.bin");

#[cfg(test)]
mod test;

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

        self.initialize_from_snapshot(surface_id, &snapshot).await
    }

    #[tracing::instrument(err, skip(self, snapshot), fields(snapshot_len = snapshot.len()))]
    async fn initialize_from_snapshot(
        &self,
        surface_id: &str,
        snapshot: &[u8],
    ) -> Result<(), CollabSurfaceError> {
        let result = Retry::start(
            FixedInterval::new(RETRY_DELAY).take(MAX_ATTEMPTS - 1),
            || async {
                match self
                    .sync_service_client
                    .initialize_from_snapshot(surface_id, snapshot)
                    .await
                {
                    // A bound pending surface may have completed initialization
                    // before the original reply or mark-ready write was lost.
                    Err(error) if error.is::<SnapshotAlreadyExists>() => Ok(()),
                    result => result,
                }
            },
        )
        .await;

        match result {
            Ok(()) => Ok(()),
            Err(e) => Err(CollabSurfaceError::Internal(
                rootcause::report!("failed to initialize sync-service session: {e:?}")
                    .into_dynamic(),
            )),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn session_exists(&self, surface_id: &str) -> Result<bool, CollabSurfaceError> {
        // `exists` is true once the durable object has the id set (e.g. after a
        // client connected), which is broader than "initialized".
        self.sync_service_client
            .exists(surface_id)
            .await
            .map_err(|e| {
                CollabSurfaceError::Internal(
                    rootcause::report!("failed to check sync-service session: {e:?}")
                        .into_dynamic(),
                )
            })
    }

    #[tracing::instrument(err, skip(self, token))]
    async fn snapshot(
        &self,
        surface_id: &str,
        token: &DocumentPermissionToken,
    ) -> Result<SurfaceSnapshot, CollabSurfaceError> {
        let state = self
            .sync_service_client
            .document_state(surface_id, token)
            .await
            .map_err(surface_state_error)?;
        Ok(SurfaceSnapshot {
            snapshot: state.snapshot,
            revision: state.revision,
        })
    }

    #[tracing::instrument(
        err,
        skip(self, token, expected_revision, update),
        fields(update_len = update.len())
    )]
    async fn update(
        &self,
        surface_id: &str,
        token: &DocumentPermissionToken,
        expected_revision: &[u8],
        update: &[u8],
    ) -> Result<SurfaceUpdate, CollabSurfaceError> {
        self.sync_service_client
            .update_document(surface_id, token, expected_revision, update)
            .await
            .map(surface_update)
            .map_err(surface_state_error)
    }

    #[tracing::instrument(err, skip(self))]
    async fn markdown(&self, surface_id: &str) -> Result<String, CollabSurfaceError> {
        self.lexical_client
            .get_markdown(surface_id, MarkdownTarget::External)
            .await
            .map_err(|e| {
                CollabSurfaceError::Internal(
                    rootcause::report!("failed to render surface markdown: {e:?}").into_dynamic(),
                )
            })
    }
}

/// A sync-service refusal of a state read or update, as the domain sees it.
/// A refused grant (`401`) is ours, so it is internal, not the caller's fault.
fn surface_state_error(error: DocumentStateError) -> CollabSurfaceError {
    match error {
        DocumentStateError::NotFound => CollabSurfaceError::NotFound,
        DocumentStateError::Forbidden => CollabSurfaceError::AccessDenied,
        DocumentStateError::TooLarge => {
            CollabSurfaceError::BadRequest("surface state exceeds the size limit".to_string())
        }
        DocumentStateError::Invalid => {
            CollabSurfaceError::BadRequest("invalid surface update or revision".to_string())
        }
        error @ (DocumentStateError::Transport(_)
        | DocumentStateError::Unauthorized
        | DocumentStateError::Rejected(_)
        | DocumentStateError::InvalidResponse(_)) => {
            CollabSurfaceError::Internal(rootcause::Report::new(error).into_dynamic())
        }
    }
}

fn surface_update(outcome: DocumentUpdate) -> SurfaceUpdate {
    match outcome {
        DocumentUpdate::Applied { revision } => SurfaceUpdate::Applied { revision },
        DocumentUpdate::Conflict => SurfaceUpdate::Conflict,
    }
}
