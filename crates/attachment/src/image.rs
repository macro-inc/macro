//! Image types for encoding and compressing images for AI consumption.

mod base_64_image;

pub use base_64_image::Base64Image;
/// An image that can be included in an attachment.
#[derive(PartialEq, Eq, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub enum ImageData {
    /// A base64-encoded image, potentially re-encoded as WebP.
    Base64(Base64Image),
    /// A publicly accessible URL pointing to the image.
    StaticUrl(String),
}

/// Pixel size of encoded image bytes, when the format is recognizable.
#[must_use]
pub fn pixel_dimensions(bytes: &[u8]) -> Option<(i32, i32)> {
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let (width, height) = reader.into_dimensions().ok()?;
    let width = i32::try_from(width).ok().filter(|value| *value > 0)?;
    let height = i32::try_from(height).ok().filter(|value| *value > 0)?;
    Some((width, height))
}

impl ImageData {
    /// Compress and re-encode raw image bytes into a downscaled WebP.
    pub fn try_from_bytes(bytes: Vec<u8>) -> Result<Self, anyhow::Error> {
        Base64Image::downscale_and_reencode(bytes).map(Self::Base64)
    }

    /// try to parse a string as a base64 image
    pub fn try_base64_from_string(s: String) -> Result<Self, anyhow::Error> {
        Base64Image::try_from_string(&s)
            .map(Self::Base64)
            .or_else(|_| Ok(Self::StaticUrl(s)))
    }
}

#[cfg(test)]
mod dimensions_test {
    use super::pixel_dimensions;
    use image::{ImageFormat, RgbImage};

    fn png(width: u32, height: u32) -> Vec<u8> {
        let img = RgbImage::from_pixel(width, height, image::Rgb([10, 120, 240]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(img)
            .write_to(&mut bytes, ImageFormat::Png)
            .expect("encode png");
        bytes.into_inner()
    }

    #[test]
    fn reads_encoded_pixel_size() {
        assert_eq!(pixel_dimensions(&png(640, 480)), Some((640, 480)));
        assert_eq!(pixel_dimensions(b"not-an-image"), None);
    }
}
