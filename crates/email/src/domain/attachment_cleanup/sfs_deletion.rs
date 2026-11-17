//! Delete a stored attachment before removing its database record.

use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Original file-service failure and the response status, when one exists.
pub struct SfsDeletionError {
    /// The unchanged error returned to the worker on failure.
    pub source: anyhow::Error,
    /// Status reported by the file-service request error, if any.
    pub response_status: Option<u16>,
}

/// Removes a file from attachment storage.
pub trait SfsFileDeletion: Send + Sync + 'static {
    /// Delete the given file, retaining the original error and response status.
    fn delete_file(
        &self,
        sfs_id: Uuid,
    ) -> impl Future<Output = Result<(), SfsDeletionError>> + Send;
}

/// Removes the stored attachment record after its file has been deleted.
pub trait SfsDeletionRepository: Send + Sync + 'static {
    /// Delete the record, including successful deletion of an already absent row.
    fn delete_attachment(&self, db_id: Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Acknowledgement selected for a delivered attachment deletion.
pub enum SfsDeletionDisposition {
    /// Delete the delivery and return its acknowledgement result.
    Delete,
    /// Retain the delivery and return the original processing error.
    LeaveForRedelivery(anyhow::Error),
}

/// Coordinates file deletion and removal of its attachment record.
pub struct SfsDeletionService<R, F> {
    /// Stored attachment records.
    pub repository: R,
    /// File-service deletion capability.
    pub files: F,
}

impl<R: SfsDeletionRepository, F: SfsFileDeletion> SfsDeletionService<R, F> {
    /// Process the decoded database/file identifiers, retaining invalid deliveries.
    pub async fn process(&self, extracted: anyhow::Result<(Uuid, Uuid)>) -> SfsDeletionDisposition {
        let (db_id, sfs_id) = match extracted {
            Ok(ids) => ids,
            Err(error) => return SfsDeletionDisposition::LeaveForRedelivery(error),
        };
        // Keep the existing wire message's diagnostic spelling without importing its transport type.
        tracing::debug!(
            sfs_message = ?format_args!("SFSDeleteMessage {{ db_id: {db_id:?}, sfs_id: {sfs_id:?} }}"),
            "Processing sfs delete message"
        );

        if let Err(error) = self.files.delete_file(sfs_id).await {
            if error.response_status == Some(404) {
                tracing::info!(sfs_id = %sfs_id, "File already deleted from SFS");
            } else {
                return SfsDeletionDisposition::LeaveForRedelivery(error.source);
            }
        }

        if let Err(error) = self.repository.delete_attachment(db_id).await {
            return SfsDeletionDisposition::LeaveForRedelivery(error);
        }
        tracing::debug!(
            sfs_message = ?format_args!("SFSDeleteMessage {{ db_id: {db_id:?}, sfs_id: {sfs_id:?} }}"),
            "Successfully deleted attachment from sfs"
        );

        SfsDeletionDisposition::Delete
    }
}
