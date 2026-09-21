//! Static-file metadata adapter for channel picture authorization.

use crate::domain::ports::{ChannelPictureFile, ChannelPictureFiles};
use static_file_service_client::StaticFileServiceClient;
use uuid::Uuid;

/// Reads authoritative file metadata through the static-file service.
#[derive(Clone)]
pub struct StaticFileChannelPictures {
    client: StaticFileServiceClient,
}

impl StaticFileChannelPictures {
    /// Create a picture metadata adapter with an authenticated service client.
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

impl ChannelPictureFiles for StaticFileChannelPictures {
    async fn get_picture_file(&self, file_id: Uuid) -> anyhow::Result<Option<ChannelPictureFile>> {
        Ok(self
            .client
            .get_file_metadata(&file_id.to_string())
            .await?
            .map(|file| ChannelPictureFile {
                owner_id: file.owner_id,
                is_uploaded: file.is_uploaded,
                content_type: file.content_type,
            }))
    }
}
