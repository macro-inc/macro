//! Attachment downloads for one account: claim observed attachments, fetch
//! and decrypt them over the account's connection, and hand the bytes to the
//! domain, at most [`TRANSFERS_PER_ACCOUNT`] transfers at a time.

use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use tokio::sync::{Notify, Semaphore, watch};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use whatsapp_linked::domain::events::{MediaFailure, MediaImport, SessionScope};
use whatsapp_linked::domain::models::LinkedError;
use whatsapp_linked::domain::session::SessionService;

use super::ports::{DownloadFailure, WhatsAppSession};

/// Concurrent uploads and downloads per account, shared by sends and imports.
pub const TRANSFERS_PER_ACCOUNT: usize = 2;
/// Largest attachment moved in either direction.
pub const MEDIA_LIMIT_BYTES: u64 = 32 * 1024 * 1024;
/// Attachments claimed per round trip.
const IMPORT_BATCH: i64 = 4;

/// Everything the download loop needs.
pub(crate) struct MediaImports<Session> {
    pub(crate) sessions: SessionService,
    pub(crate) scope: SessionScope,
    pub(crate) session: Arc<Session>,
    pub(crate) transfers: Arc<Semaphore>,
    /// Woken when new events were ingested (they may reserve attachments).
    pub(crate) wake: Arc<Notify>,
    /// Downloads only run while connected.
    pub(crate) connected: watch::Receiver<bool>,
    pub(crate) every: Duration,
    /// Cancelled when a write was fenced.
    pub(crate) fenced: CancellationToken,
}

impl<Session: WhatsAppSession> MediaImports<Session> {
    /// Imports until `stop`.
    pub(crate) async fn run(mut self, stop: CancellationToken) {
        loop {
            tokio::select! {
                () = stop.cancelled() => return,
                () = self.fenced.cancelled() => return,
                () = self.wake.notified() => {}
                () = tokio::time::sleep(self.every) => {}
            }
            let connected = tokio::select! {
                () = stop.cancelled() => return,
                connected = self.connected.wait_for(|connected| *connected) => connected.is_ok(),
            };
            if !connected {
                return;
            }
            if !self.import_claimed().await {
                return;
            }
        }
    }

    /// Imports until nothing is claimable; `false` once fenced.
    async fn import_claimed(&self) -> bool {
        loop {
            let claimed = match self
                .sessions
                .claim_media_imports(self.scope, IMPORT_BATCH)
                .await
            {
                Ok(claimed) => claimed,
                Err(report) if matches!(report.current_context(), LinkedError::Fenced) => {
                    self.fenced.cancel();
                    return false;
                }
                Err(report) => {
                    tracing::warn!(error = ?report, "Claiming WhatsApp attachments failed");
                    return true;
                }
            };
            if claimed.is_empty() {
                return true;
            }
            join_all(claimed.iter().map(|import| self.import(import))).await;
            if self.fenced.is_cancelled() {
                return false;
            }
        }
    }

    async fn import(&self, import: &MediaImport) {
        let Ok(_permit) = self.transfers.acquire().await else {
            return;
        };
        let span = tracing::info_span!(
            "whatsapp.media.import",
            account_id = %self.scope.account_id,
            binding_id = %import.attachment.binding_id,
            ordinal = import.attachment.ordinal,
            size = import.size,
            outcome = tracing::field::Empty,
        );
        async {
            let downloaded = if import.size > MEDIA_LIMIT_BYTES {
                Err(DownloadFailure::Permanent)
            } else {
                self.session.download_media(import).await
            };
            let result = match downloaded {
                Ok(bytes) if bytes.len() as u64 > MEDIA_LIMIT_BYTES => {
                    self.fail(import, MediaFailure::Permanent).await
                }
                Ok(bytes) => {
                    tracing::Span::current().record("outcome", "imported");
                    self.sessions
                        .complete_media_import(self.scope, &import.attachment, &bytes)
                        .await
                }
                Err(DownloadFailure::Retryable) => self.fail(import, MediaFailure::Retryable).await,
                Err(DownloadFailure::Permanent) => self.fail(import, MediaFailure::Permanent).await,
            };
            if let Err(report) = result {
                if matches!(report.current_context(), LinkedError::Fenced) {
                    self.fenced.cancel();
                } else {
                    tracing::warn!(error = ?report, "Recording a WhatsApp attachment failed");
                }
            }
        }
        .instrument(span)
        .await
    }

    async fn fail(
        &self,
        import: &MediaImport,
        failure: MediaFailure,
    ) -> whatsapp_linked::domain::ports::LinkedResult<()> {
        tracing::Span::current().record(
            "outcome",
            match failure {
                MediaFailure::Retryable => "retry",
                MediaFailure::Permanent => "failed",
            },
        );
        self.sessions
            .fail_media_import(self.scope, &import.attachment, failure)
            .await
    }
}
