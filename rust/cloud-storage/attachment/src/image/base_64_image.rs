#[cfg(test)]
mod test;

use anyhow::{Result, anyhow};
use base64::Engine;
use base64::engine::general_purpose;
use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};
use webp::Encoder;

const ENCODING_QUALITY: f32 = 75.0;
/// The maximum length, in pixels, of an image's longest side.
const MAX_DIMENSION: u32 = 1080;

/// A base64-encoded WebP image.
///
/// All images are normalized on construction: downscaled so their longest side
/// is at most [`MAX_DIMENSION`] pixels and (re-)encoded as WebP at 75% quality
/// to reduce token cost when sent to an AI model. The type itself is the
/// guarantee that its data is a downscaled WebP — there is no other format to
/// track.
#[derive(Eq, PartialEq, Clone, Serialize, Deserialize)]
pub struct Base64Image {
    /// Raw base64-encoded WebP data, without any `data:` URI prefix.
    data: String,
}

impl Base64Image {
    /// Normalize raw image bytes of any format into a downscaled base64 WebP.
    ///
    /// Bytes that are already a WebP within the size bound are kept verbatim;
    /// anything else is decoded, downscaled, and re-encoded as WebP.
    pub fn downscale_and_reencode(bytes: Vec<u8>) -> Result<Self> {
        let img = image::load_from_memory(&bytes)?;
        let (width, height) = img.dimensions();

        let already_webp = image::guess_format(&bytes).ok() == Some(image::ImageFormat::WebP);
        if already_webp && width <= MAX_DIMENSION && height <= MAX_DIMENSION {
            return Ok(Self::from_webp_bytes(&bytes));
        }

        let resized = Self::resize_if_needed(img);
        let rgb = resized.to_rgb8();
        let encoder = Encoder::from_rgb(&rgb, rgb.width(), rgb.height());
        let webp = encoder.encode(ENCODING_QUALITY);
        Ok(Self::from_webp_bytes(&webp))
    }

    /// Parse a base64 `data:` URI and normalize it into a downscaled WebP.
    pub(crate) fn try_from_string(s: &str) -> Result<Self> {
        let base64 = s
            .strip_prefix("data:")
            .and_then(|rest| rest.split_once(";base64,"))
            .map(|(_, data)| data)
            .ok_or_else(|| anyhow!("not a base64-encoded data URI"))?;
        let bytes = general_purpose::STANDARD.decode(base64)?;
        Self::downscale_and_reencode(bytes)
    }

    /// The raw base64-encoded WebP data, without any `data:` URI prefix.
    pub fn base64_data(&self) -> &str {
        &self.data
    }

    fn from_webp_bytes(webp: &[u8]) -> Self {
        Self {
            data: general_purpose::STANDARD.encode(webp),
        }
    }

    fn resize_if_needed(img: DynamicImage) -> DynamicImage {
        let (width, height) = img.dimensions();
        if width <= MAX_DIMENSION && height <= MAX_DIMENSION {
            return img;
        }

        // Scale the longest side down to MAX_DIMENSION, preserving aspect ratio.
        let ratio = (MAX_DIMENSION as f32 / width as f32).min(MAX_DIMENSION as f32 / height as f32);
        let new_width = (width as f32 * ratio) as u32;
        let new_height = (height as f32 * ratio) as u32;

        img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3)
    }
}

impl std::fmt::Display for Base64Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "data:image/webp;base64,{}", self.data)
    }
}

impl std::fmt::Debug for Base64Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "data:image/webp;base64,[{} bytes]", self.data.len())
    }
}
