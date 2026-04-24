mod base_64_image;

pub use base_64_image::*;

#[derive(PartialEq, Eq, Clone)]
pub enum ImageData {
    Base64(Base64Image),
    StaticUrl(String),
}

impl ImageData {
    /// convert image bytes into a downscaled webp
    pub fn try_from_bytes(bytes: Vec<u8>) -> Result<Self, anyhow::Error> {
        Base64Image::compress_and_reencode(bytes).map(Self::Base64)
    }

    pub(crate) fn dangerously_try_from_string(s: String) -> Result<Self, anyhow::Error> {
        Base64Image::try_from_string(&s)
            .map(Self::Base64)
            .or_else(|_| Ok(Self::StaticUrl(s)))
    }
}
