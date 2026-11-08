//! Keeps rendered canvas images as static files owned by the caller.

use async_trait::async_trait;
use documents_hex::domain::canvas::{CanvasImageStore, StoredCanvasImage};
use macro_user_id::user_id::MacroUserIdStr;
use static_file_service_client::StaticFileServiceClient;

/// Static file storage for canvas renders.
pub struct StaticFileCanvasImages(pub StaticFileServiceClient);

#[async_trait]
impl CanvasImageStore for StaticFileCanvasImages {
    #[tracing::instrument(
        name = "canvas.store_render",
        skip_all,
        err,
        fields(size = png.len(), file_id)
    )]
    async fn save_png(
        &self,
        owner: &MacroUserIdStr<'static>,
        name: &str,
        png: Vec<u8>,
    ) -> anyhow::Result<StoredCanvasImage> {
        let stored = self
            .0
            .put_named_bytes_for_user(owner.as_ref(), name, png.into(), "image/png")
            .await?;
        tracing::Span::current().record("file_id", stored.id.as_str());
        Ok(StoredCanvasImage {
            file_id: stored.id,
            url: stored.file_location,
        })
    }
}
