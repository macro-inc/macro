//! Pixels of the images a code-mode program returned, read from static file storage.
use agent_code_mode::domain::{
    ModelImage, ModelImageMediaType, ModelImages, ModelMediaType, StaticFileId,
};
use async_trait::async_trait;
use base64::Engine as _;
use macro_user_id::user_id::MacroUserIdStr;
use static_file_service_client::StaticFileServiceClient;

#[cfg(test)]
mod test;

/// The bound `agent::tool_media` applies to the base64 of a model image.
const MAX_BASE64_BYTES: usize = 4_000_000;
/// The most PNG bytes whose base64 fits [`MAX_BASE64_BYTES`].
const MAX_PNG_BYTES: usize = MAX_BASE64_BYTES / 4 * 3;

/// Static files read by id from the configured static file service.
pub struct StaticFileModelImages(pub StaticFileServiceClient);

#[async_trait]
impl ModelImages for StaticFileModelImages {
    #[tracing::instrument(name = "code_mode.load_image", skip_all, err, fields(file_id = file.as_ref(), size = tracing::field::Empty))]
    async fn load_png(
        &self,
        file: &StaticFileId,
        owner: &MacroUserIdStr<'_>,
    ) -> anyhow::Result<ModelImage> {
        // Refuse other people's files and other uploads before downloading them.
        let metadata = self
            .0
            .get_file_metadata(file.as_ref())
            .await?
            .ok_or_else(|| anyhow::anyhow!("no such file"))?;
        owned_png(&metadata.owner_id, &metadata.content_type, owner)?;
        let bytes = self
            .0
            .read_file_bounded(file.as_ref(), MAX_PNG_BYTES)
            .await?;
        tracing::Span::current().record("size", bytes.len());
        png_image(&bytes)
    }
}

/// A file shows the model only when the account the execution acted as owns
/// it and says it is a PNG.
fn owned_png(
    file_owner: &str,
    content_type: &str,
    owner: &MacroUserIdStr<'_>,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        file_owner == owner.as_ref(),
        "the file belongs to someone else"
    );
    anyhow::ensure!(content_type == "image/png", "not a PNG");
    Ok(())
}

/// Only a bounded PNG becomes model media.
fn png_image(bytes: &[u8]) -> anyhow::Result<ModelImage> {
    anyhow::ensure!(bytes.len() <= MAX_PNG_BYTES, "PNG too large for the model");
    // Reads the signature and header chunk only; decoding the pixels would
    // allocate width x height x 4 bytes for an image the model decodes anyway.
    let header = png::Decoder::new(std::io::Cursor::new(bytes)).read_info()?;
    let info = header.info();
    anyhow::ensure!(info.width > 0 && info.height > 0, "empty PNG");
    Ok(ModelImage {
        r#type: ModelMediaType::Image,
        media_type: ModelImageMediaType::Png,
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}
