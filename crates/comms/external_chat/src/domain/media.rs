//! Turns downloaded and uploaded attachment bytes into static files, and
//! deletes the static files no attachment references any more. Runs in DSS.

use super::ports::*;
use std::sync::Arc;

/// Failed imports before the attachment is shown as unavailable.
const MAX_IMPORT_ATTEMPTS: i32 = 5;

/// Drains the import and deletion queues.
#[derive(Clone)]
pub struct MediaService {
    repository: Arc<dyn MediaRepository>,
    files: Arc<dyn FileStore>,
}

impl MediaService {
    /// Wire the queues and static file storage.
    pub fn new(repository: Arc<dyn MediaRepository>, files: Arc<dyn FileStore>) -> Self {
        Self { repository, files }
    }

    /// Import one batch; one failing file never blocks the others. Returns how
    /// many were imported.
    #[tracing::instrument(
        name = "whatsapp.linked.import_media",
        skip_all,
        err,
        fields(due, imported)
    )]
    pub async fn import_pending(&self) -> ExternalChatResult<usize> {
        let due = self.repository.due_imports(8).await?;
        tracing::Span::current().record("due", due.len());
        let mut imported = 0;
        for import in &due {
            // One file's bytes in memory at a time.
            let Some(bytes) = self.repository.import_bytes(import).await? else {
                continue;
            };
            match self.files.store(import, bytes).await {
                Ok(file_id) => {
                    self.repository.import_stored(import, file_id).await?;
                    imported += 1;
                }
                Err(error) => {
                    tracing::warn!(
                        blob_id = %import.blob_id,
                        attempts = import.attempts,
                        code = error.current_context().code(),
                        error = %error,
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

    /// Delete one batch of static files no attachment references any more; a
    /// file that fails stays queued and is retried later. Returns how many
    /// were deleted.
    #[tracing::instrument(
        name = "whatsapp.linked.delete_files",
        skip_all,
        err,
        fields(due, deleted)
    )]
    pub async fn delete_released(&self) -> ExternalChatResult<usize> {
        let due = self.repository.due_file_deletions(25).await?;
        tracing::Span::current().record("due", due.len());
        let mut deleted = vec![];
        for file_id in due {
            match self.files.delete(file_id).await {
                Ok(()) => deleted.push(file_id),
                Err(error) => tracing::warn!(
                    file_id = %file_id,
                    code = error.current_context().code(),
                    error = %error,
                    "Deleting a WhatsApp attachment file will retry"
                ),
            }
        }
        self.repository.files_deleted(&deleted).await?;
        tracing::Span::current().record("deleted", deleted.len());
        Ok(deleted.len())
    }

    /// Delete staged uploads that were never sent.
    pub async fn expire_uploads(&self) -> ExternalChatResult<u64> {
        self.repository.expire_uploads().await
    }
}
