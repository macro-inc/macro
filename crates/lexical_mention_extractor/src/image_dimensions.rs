//! Static-file adapter for the messages `MessageImageDimensions` port.

use attachment::image::pixel_dimensions;
use messages::domain::ports::MessageImageDimensions;
use static_file_service_client::StaticFileServiceClient;
use uuid::Uuid;

/// Reads generated and uploaded image bytes from static file service.
#[derive(Clone)]
pub struct StaticFileImageDimensions {
    client: StaticFileServiceClient,
}

impl StaticFileImageDimensions {
    /// Use an already-configured static file service client.
    pub fn new(client: StaticFileServiceClient) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl MessageImageDimensions for StaticFileImageDimensions {
    async fn dimensions(&self, static_file_id: Uuid) -> Option<(i32, i32)> {
        let bytes = self
            .client
            .read_file(&static_file_id.to_string())
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error = ?error,
                    %static_file_id,
                    "could not read a static image for attachment dimensions"
                );
            })
            .ok()?;
        pixel_dimensions(&bytes)
    }
}
