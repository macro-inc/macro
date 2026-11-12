//! Domain ports for the static file service.

use std::future::Future;

/// Port for fetching static files.
pub trait StaticFileRepo: Send + Sync + 'static {
    /// Get the content type of a file without downloading the body.
    fn content_type(
        &self,
        file_id: &str,
    ) -> impl Future<Output = anyhow::Result<mime::Mime>> + Send;

    /// Download the file bytes.
    fn read(&self, file_id: &str) -> impl Future<Output = anyhow::Result<Vec<u8>>> + Send;
}
