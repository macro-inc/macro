//! Staged WhatsApp profile pictures become static files owned by the
//! observing account's owner. Runs in DSS; files a picture lets go of are
//! deleted with released attachments.

use super::{models::StagedPicture, ports::PictureRepository};
use external_chat::domain::ports::{ExternalChatResult, FileStore};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Pictures stored per call; a caller drains until a call stores none.
pub(crate) const IMPORT_BATCH: i64 = 8;

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
        fields(due, stored, superseded, failed)
    )]
    pub async fn import_staged(&self) -> ExternalChatResult<usize> {
        let due = self.repository.staged_pictures(IMPORT_BATCH).await?;
        tracing::Span::current().record("due", due.len());
        let mut stored = 0;
        let mut superseded = 0;
        let mut failed = 0;
        for picture in due {
            match self.import(picture).await {
                Imported::Stored => stored += 1,
                Imported::Superseded => superseded += 1,
                Imported::Failed => failed += 1,
            }
        }
        let span = tracing::Span::current();
        span.record("stored", stored);
        span.record("superseded", superseded);
        span.record("failed", failed);
        Ok(stored + superseded)
    }

    /// Store one picture and record the outcome. A failed record leaves the
    /// row staged to retry later; the file it names is logged, since the
    /// write may have landed and the file can't be told apart from a used one.
    async fn import(&self, picture: StagedPicture) -> Imported {
        let StagedPicture {
            account_id,
            user_id,
            jid,
            picture_id,
            bytes,
            mime,
        } = picture;
        match self.files.store_picture(&user_id, &mime, bytes).await {
            Ok(file_id) => match self
                .repository
                .picture_stored(account_id, &jid, &picture_id, file_id)
                .await
            {
                Ok(true) => Imported::Stored,
                Ok(false) => Imported::Superseded,
                Err(error) => {
                    tracing::warn!(
                        %account_id,
                        %file_id,
                        code = error.current_context().code(),
                        error = %error,
                        "Recording a stored WhatsApp profile picture failed; it retries"
                    );
                    Imported::Failed
                }
            },
            Err(error) => {
                tracing::warn!(
                    %account_id,
                    code = error.current_context().code(),
                    error = %error,
                    "Storing a WhatsApp profile picture failed; it retries"
                );
                if let Err(error) = self
                    .repository
                    .picture_store_failed(account_id, &jid, &picture_id)
                    .await
                {
                    tracing::warn!(
                        %account_id,
                        code = error.current_context().code(),
                        error = %error,
                        "Recording a WhatsApp profile picture failure failed"
                    );
                }
                Imported::Failed
            }
        }
    }
}

/// What became of one staged picture.
enum Imported {
    Stored,
    Superseded,
    Failed,
}
