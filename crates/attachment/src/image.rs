//! Image types for encoding and compressing images for AI consumption.

mod base_64_image;

pub use base_64_image::Base64Image;
/// An image that can be included in an attachment.
#[derive(PartialEq, Eq, Clone, Debug, serde::Serialize, serde::Deserialize)]
pub enum ImageData {
    /// A base64-encoded image, potentially re-encoded as WebP.
    Base64(Base64Image),
    /// A publicly accessible URL pointing to the image.
    StaticUrl {
        /// Where the image is served.
        url: String,
        /// The image's MIME type, when known. Some providers (Gemini) refuse
        /// an image URL without one.
        mime_type: Option<String>,
    },
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
            .or_else(|_| {
                Ok(Self::StaticUrl {
                    url: s,
                    mime_type: None,
                })
            })
    }
}
