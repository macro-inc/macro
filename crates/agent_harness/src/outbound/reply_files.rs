//! [`ReplyFiles`] backed by the static file service's metadata.

use static_file_service_client::StaticFileServiceClient;

use crate::domain::error::{HarnessError, Result};
use crate::domain::ports::ReplyFiles;

/// Looks up the files a reply's attachment markers name.
pub struct StaticFileReplyFiles {
    client: StaticFileServiceClient,
}

impl StaticFileReplyFiles {
    /// Use the internally authenticated static file service client.
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

impl ReplyFiles for StaticFileReplyFiles {
    async fn content_type(&self, static_file_id: macro_uuid::Uuid) -> Result<Option<String>> {
        let metadata = self
            .client
            .get_file_metadata(&static_file_id.to_string())
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        // `is_uploaded` flips only when the store's upload event has been
        // processed, seconds after a generated image's bytes are already
        // saved; a reply posted right after generating would lose its image.
        Ok(metadata.map(|metadata| metadata.content_type))
    }
}
