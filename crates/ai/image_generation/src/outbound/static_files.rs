//! Saves generated images through the static file service client.
use crate::domain::{
    models::{NewStaticImage, SaveImageError, StoredImage},
    ports::ImageStore,
};
use static_file_service_client::StaticFileServiceClient;

/// Adapter to the static file upload lifecycle.
pub struct StaticFileImageStore {
    client: StaticFileServiceClient,
}

impl StaticFileImageStore {
    /// Use an already-configured static file service client.
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

impl ImageStore for StaticFileImageStore {
    #[tracing::instrument(skip_all, err)]
    async fn save_image(&self, image: NewStaticImage) -> Result<StoredImage, SaveImageError> {
        let stored = self
            .client
            .put_named_bytes("generated-image", image.bytes.into(), &image.mime_type)
            .await
            .map_err(|error| SaveImageError::Internal(rootcause::report!(error).into()))?;
        Ok(StoredImage {
            id: stored
                .id
                .parse::<uuid::Uuid>()
                .map_err(|error| SaveImageError::Internal(rootcause::report!(error).into()))?,
            url: stored.file_location,
        })
    }
}

#[cfg(test)]
mod test;
