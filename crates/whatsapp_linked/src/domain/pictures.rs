//! Staged WhatsApp profile pictures become static files owned by the
//! observing account's owner. Runs in DSS; files a picture lets go of are
//! deleted with released attachments.

use super::ports::PictureRepository;
use external_chat::domain::ports::{ExternalChatResult, FileStore};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Stores staged pictures as static files.
#[derive(Clone)]
pub struct PictureImports {
    repository: Arc<dyn PictureRepository>,
    files: Arc<dyn FileStore>,
}

impl PictureImports {
    /// Wire the staged pictures and static file storage.
    pub fn new(repository: Arc<dyn PictureRepository>, files: Arc<dyn FileStore>) -> Self {
        Self { repository, files }
    }

    /// Store one batch; one failing picture never blocks the others. Returns
    /// how many left staging (stored, or replaced meanwhile), so a caller
    /// drains until nothing is left that can be stored now.
    #[tracing::instrument(
        name = "whatsapp.picture.import",
        skip_all,
        err,
        fields(due, stored, superseded)
    )]
    pub async fn import_staged(&self) -> ExternalChatResult<usize> {
        let due = self.repository.staged_pictures(8).await?;
        tracing::Span::current().record("due", due.len());
        let mut stored = 0;
        let mut superseded = 0;
        for picture in due {
            match self
                .files
                .store_picture(&picture.user_id, &picture.mime, picture.bytes)
                .await
            {
                Ok(file_id) => {
                    let current = self
                        .repository
                        .picture_stored(
                            picture.account_id,
                            &picture.jid,
                            &picture.picture_id,
                            file_id,
                        )
                        .await?;
                    if current {
                        stored += 1;
                    } else {
                        superseded += 1;
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        account_id = %picture.account_id,
                        code = error.current_context().code(),
                        error = %error,
                        "WhatsApp profile picture import will retry"
                    );
                    self.repository
                        .picture_store_failed(picture.account_id, &picture.jid, &picture.picture_id)
                        .await?;
                }
            }
        }
        let span = tracing::Span::current();
        span.record("stored", stored);
        span.record("superseded", superseded);
        Ok(stored + superseded)
    }
}
