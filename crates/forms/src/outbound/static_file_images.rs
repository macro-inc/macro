//! The files a form's branding shows, as the static-file service records
//! them.

use static_file_service_client::StaticFileServiceClient;
use uuid::Uuid;

use crate::domain::models::StoredImageFile;
use crate::domain::ports::FormImageFiles;

/// Reads file metadata through the static-file service's internal API.
#[derive(Clone)]
pub struct StaticFileFormImages {
    client: StaticFileServiceClient,
}

impl StaticFileFormImages {
    /// Read through `client`, authenticated with the internal key.
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

/// The static-file service could not be read.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct StaticFileImagesError(#[from] anyhow::Error);

impl FormImageFiles for StaticFileFormImages {
    type Error = StaticFileImagesError;

    #[tracing::instrument(err, skip(self))]
    async fn image_file(&self, file: Uuid) -> Result<Option<StoredImageFile>, Self::Error> {
        Ok(self
            .client
            .get_file_metadata(&file.to_string())
            .await?
            .map(|metadata| StoredImageFile {
                owner_id: metadata.owner_id,
                content_type: metadata.content_type,
            }))
    }
}
