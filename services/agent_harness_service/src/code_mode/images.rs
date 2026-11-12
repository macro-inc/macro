//! Pixels of the images a code-mode program returned, read from static file storage.
use agent_code_mode::domain::{
    ModelImage, ModelImageMediaType, ModelImages, ModelMediaType, StaticFileId,
};
use async_trait::async_trait;
use base64::Engine as _;
use static_file_service_client::StaticFileServiceClient;

#[cfg(test)]
mod test;

/// The bound `agent::tool_media` applies to the base64 of a model image.
const MAX_BASE64_BYTES: usize = 4_000_000;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Static files read by id from the configured static file service.
pub struct StaticFileModelImages(pub StaticFileServiceClient);

#[async_trait]
impl ModelImages for StaticFileModelImages {
    #[tracing::instrument(name = "code_mode.load_image", skip_all, err, fields(file_id = file.as_ref(), size = tracing::field::Empty))]
    async fn load_png(&self, file: &StaticFileId) -> anyhow::Result<ModelImage> {
        let bytes = self.0.read_file(file.as_ref()).await?;
        tracing::Span::current().record("size", bytes.len());
        png_image(&bytes)
    }
}

/// Only a bounded PNG becomes model media.
fn png_image(bytes: &[u8]) -> anyhow::Result<ModelImage> {
    anyhow::ensure!(bytes.starts_with(PNG_SIGNATURE), "not a PNG");
    anyhow::ensure!(
        base64::encoded_len(bytes.len(), true).is_some_and(|len| len <= MAX_BASE64_BYTES),
        "PNG too large for the model"
    );
    Ok(ModelImage {
        r#type: ModelMediaType::Image,
        media_type: ModelImageMediaType::Png,
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}
