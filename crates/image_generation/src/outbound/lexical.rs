//! Image markup composition through the Lexical service.
use crate::domain::{
    models::{ComposeImageError, StoredImage},
    ports::ImageMarkdownComposer,
};
use lexical_client::{LexicalClient, parse_markdown::ImageMarkdownRequest};
use std::sync::Arc;

/// Adapter delegating image serialization to the owning editor service.
pub struct LexicalImageMarkdownComposer {
    client: Arc<LexicalClient>,
}

impl LexicalImageMarkdownComposer {
    /// Use the host's authenticated Lexical service client.
    pub fn new(client: Arc<LexicalClient>) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl ImageMarkdownComposer for LexicalImageMarkdownComposer {
    #[tracing::instrument(skip_all, err)]
    async fn compose_image(
        &self,
        image: &StoredImage,
        width: u32,
        height: u32,
    ) -> Result<String, ComposeImageError> {
        self.client
            .compose_image_markdown(&ImageMarkdownRequest {
                static_file_id: &image.id.to_string(),
                url: &image.url,
                width,
                height,
            })
            .await
            .map_err(|error| ComposeImageError(rootcause::report!(error).into()))
    }
}

#[cfg(test)]
mod test;
