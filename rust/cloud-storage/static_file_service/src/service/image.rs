use anyhow::{Context, Result};
use image::{ImageFormat, ImageReader, codecs::jpeg::JpegEncoder};
use std::io::Cursor;

pub const MAX_DIMENSION: u32 = 1080;
pub const JPEG_QUALITY: u8 = 85;
pub const MAX_INPUT_BYTES: usize = 50 * 1024 * 1024;

pub fn format_from_content_type(content_type: &str) -> Option<ImageFormat> {
    ImageFormat::from_mime_type(content_type)
}

pub enum DownscaleOutcome {
    Replaced { bytes: Vec<u8> },
    Skipped,
}

#[tracing::instrument(err, skip(bytes), fields(bytes_len = bytes.len(), ?format))]
pub fn try_downscale(bytes: &[u8], format: ImageFormat) -> Result<DownscaleOutcome> {
    if bytes.len() > MAX_INPUT_BYTES {
        tracing::warn!(bytes_len = bytes.len(), "skipping: exceeds max input size");
        return Ok(DownscaleOutcome::Skipped);
    }

    if !format.can_read() || !format.can_write() {
        return Ok(DownscaleOutcome::Skipped);
    }

    let mut reader = ImageReader::new(Cursor::new(bytes));
    reader.set_format(format);
    let img = reader.decode().context("failed to decode image")?;

    let (w, h) = (img.width(), img.height());
    if w.max(h) <= MAX_DIMENSION {
        return Ok(DownscaleOutcome::Skipped);
    }

    let resized = img.resize(
        MAX_DIMENSION,
        MAX_DIMENSION,
        image::imageops::FilterType::Lanczos3,
    );

    let mut out = Vec::new();
    if format == ImageFormat::Jpeg {
        let rgb = resized.to_rgb8();
        let mut encoder = JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .context("failed to encode jpeg")?;
    } else {
        resized
            .write_to(&mut Cursor::new(&mut out), format)
            .with_context(|| format!("failed to encode {format:?}"))?;
    }

    tracing::info!(
        original_bytes = bytes.len(),
        resized_bytes = out.len(),
        original_w = w,
        original_h = h,
        "downscaled image"
    );

    Ok(DownscaleOutcome::Replaced { bytes: out })
}

#[cfg(test)]
mod test;
