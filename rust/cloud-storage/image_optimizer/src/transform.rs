use anyhow::{Context, Result, bail};
use image::imageops::FilterType;
use image::{ImageDecoder, ImageFormat};
use serde::Deserialize;
use std::io::Cursor;

use crate::request::AsyncResizeRequest;

const MAX_SIZE: u32 = 4096;

/// Raw query parameters deserialized from the CF-rewritten path suffix.
#[derive(Deserialize)]
pub struct QueryParams {
    /// Target size in pixels (longest edge).
    pub size: Option<u32>,
}

/// Validated resize parameters.
pub struct TransformParams {
    /// Target size in pixels (longest edge). Images smaller than this are not upscaled.
    pub size: u32,
}

impl TransformParams {
    /// Parses the CF-rewritten path suffix (e.g. `size=1080`) using `serde_urlencoded`.
    /// Returns `None` if `size` is absent or out of range.
    pub fn from_suffix(suffix: &str) -> Option<Self> {
        let query: QueryParams = serde_urlencoded::from_str(&suffix.replace(',', "&")).ok()?;
        let size = query.size.filter(|s| (1..=MAX_SIZE).contains(s))?;
        Some(Self { size })
    }

    /// Reconstructs transform parameters from an [`AsyncResizeRequest`] payload.
    pub fn from_async_request(req: &AsyncResizeRequest) -> Self {
        Self { size: req.size }
    }
}

/// Decodes, resizes, and re-encodes an image in its original format.
///
/// 1. Detect the source format from magic bytes.
/// 2. Decode and apply EXIF orientation.
/// 3. Downscale if either dimension exceeds `params.size` (aspect-ratio-preserving).
/// 4. Re-encode in the source format. Bails if the format cannot be written.
///
/// Animated formats (GIF) are returned as-is because frame-by-frame resizing is not supported.
pub fn transform_image(bytes: &[u8], params: &TransformParams) -> Result<(Vec<u8>, ImageFormat)> {
    // 1. Detect source format from magic bytes.
    let source_format = match image::guess_format(bytes) {
        Ok(f) => f,
        Err(e) => bail!("failed to detect image format: {e}"),
    };

    if source_format == ImageFormat::Gif {
        return Ok((bytes.to_vec(), ImageFormat::Gif));
    }

    if !source_format.can_write() {
        bail!("format {source_format:?} cannot be re-encoded");
    }

    // 2. Decode and correct for EXIF orientation.
    let mut reader = image::ImageReader::new(Cursor::new(bytes));
    reader.set_format(source_format);
    let mut decoder = reader.into_decoder().context("failed to create decoder")?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = image::DynamicImage::from_decoder(decoder).context("failed to decode image")?;
    img.apply_orientation(orientation);

    // 3. Downscale if the image is larger than the requested size. Images already
    //    at or below the target size are left untouched (no upscaling).
    let size = params.size;
    let img = if img.width() > size || img.height() > size {
        img.resize(size, size, FilterType::Lanczos3)
    } else {
        img
    };

    // 4. Re-encode in the source format.
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, source_format)
        .context("failed to encode image")?;

    Ok((buf.into_inner(), source_format))
}
