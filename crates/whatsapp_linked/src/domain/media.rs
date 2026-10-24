//! Turns downloaded and uploaded attachment bytes into private documents. Runs
//! in DSS, which owns document storage.

use super::ports::*;
use std::sync::Arc;

/// Failed imports before the attachment is shown as unavailable.
const MAX_IMPORT_ATTEMPTS: i32 = 5;

/// Drains the import queue.
#[derive(Clone)]
pub struct MediaService {
    repository: Arc<dyn MediaRepository>,
    documents: Arc<dyn DocumentStore>,
}

impl MediaService {
    /// Wire the queue and document storage.
    pub fn new(repository: Arc<dyn MediaRepository>, documents: Arc<dyn DocumentStore>) -> Self {
        Self {
            repository,
            documents,
        }
    }

    /// Import one batch; one failing file never blocks the others. Returns how
    /// many were imported.
    #[tracing::instrument(
        name = "whatsapp.linked.import_media",
        skip_all,
        err,
        fields(due, imported)
    )]
    pub async fn import_pending(&self) -> LinkedResult<usize> {
        let due = self.repository.due_imports(8).await?;
        tracing::Span::current().record("due", due.len());
        let mut imported = 0;
        for import in &due {
            match self.documents.store(import).await {
                Ok(()) => {
                    self.repository.import_stored(import).await?;
                    imported += 1;
                }
                Err(error) => {
                    tracing::warn!(
                        document_id = %import.document_id,
                        attempts = import.attempts,
                        code = error.current_context().code(),
                        "WhatsApp attachment import will retry"
                    );
                    self.repository
                        .import_failed(import, import.attempts + 1 >= MAX_IMPORT_ATTEMPTS)
                        .await?;
                }
            }
        }
        tracing::Span::current().record("imported", imported);
        Ok(imported)
    }

    /// Delete staged uploads that were never sent.
    pub async fn expire_uploads(&self) -> LinkedResult<u64> {
        self.repository.expire_uploads().await
    }
}
