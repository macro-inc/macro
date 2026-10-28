//! Re-hosting artifacts on Macro's static file service.

use crate::domain::ports::ArtifactStore;
use static_file_service_client::StaticFileServiceClient;

/// Stores artifacts on the static file service, which is where every other
/// user-visible blob in Macro already lives — so an artifact is served,
/// permissioned, and expired exactly like an uploaded image is.
#[derive(Clone)]
pub struct StaticFileArtifactStore {
    client: StaticFileServiceClient,
}

impl StaticFileArtifactStore {
    /// Wire the store to a client of the static file service.
    #[must_use]
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

impl ArtifactStore for StaticFileArtifactStore {
    async fn store(
        &self,
        file_name: &str,
        mime_type: &str,
        bytes: bytes::Bytes,
    ) -> Result<String, rootcause::Report> {
        let stored = self
            .client
            .put_named_bytes(file_name, bytes, mime_type)
            .await
            .map_err(|error| rootcause::report!("{error}"))?;
        Ok(stored.file_location)
    }
}
