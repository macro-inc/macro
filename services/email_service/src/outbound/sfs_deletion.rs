//! Existing file-service and attachment-record deletion leaves.

use email::domain::attachment_cleanup::sfs_deletion::{
    SfsDeletionError, SfsDeletionRepository, SfsFileDeletion,
};
use sqlx::PgPool;
use static_file_service_client::StaticFileServiceClient;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Attachment-record deletion through the existing database client.
pub struct PgSfsDeletion(pub PgPool);

impl SfsDeletionRepository for PgSfsDeletion {
    async fn delete_attachment(&self, db_id: Uuid) -> anyhow::Result<()> {
        email_db_client::attachments::sfs::delete_attachment_sfs(&self.0, db_id).await
    }
}

/// File deletion through the existing static-file-service client.
pub struct SfsDeletionClient(pub StaticFileServiceClient);

impl SfsFileDeletion for SfsDeletionClient {
    async fn delete_file(&self, sfs_id: Uuid) -> Result<(), SfsDeletionError> {
        self.0
            .delete_file(sfs_id.to_string().as_str())
            .await
            .map(|_| ())
            .map_err(deletion_error)
    }
}

fn deletion_error(source: anyhow::Error) -> SfsDeletionError {
    let response_status = source
        .downcast_ref::<reqwest::Error>()
        .and_then(|error| error.status())
        .map(|status| status.as_u16());
    SfsDeletionError {
        source,
        response_status,
    }
}
