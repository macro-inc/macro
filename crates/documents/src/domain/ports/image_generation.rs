//! Port for text-to-image generation.
//!
//! The documents domain turns a generated image into an ordinary image
//! document (see [`crate::domain::create::generated_image`]); this port is the
//! model call itself, implemented by an outbound adapter per provider.

use model::document::FileType;

/// The shape of image the model is asked for, as the model vocabulary calls
/// it. The closed set keeps the agent from inventing ratios the provider
/// rejects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageAspectRatio {
    /// 1:1
    Square,
    /// 4:3
    Landscape,
    /// 3:4
    Portrait,
    /// 16:9
    Widescreen,
    /// 9:16
    Tall,
}

impl ImageAspectRatio {
    /// The `width:height` form image providers accept.
    pub fn as_ratio(self) -> &'static str {
        match self {
            Self::Square => "1:1",
            Self::Landscape => "4:3",
            Self::Portrait => "3:4",
            Self::Widescreen => "16:9",
            Self::Tall => "9:16",
        }
    }
}

/// What to generate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageGenerationRequest {
    /// Natural-language description of the image.
    pub prompt: String,
    /// Requested shape; the provider default when `None`.
    pub aspect_ratio: Option<ImageAspectRatio>,
}

/// A generated image, as the provider returned it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedImage {
    /// Encoded image bytes in the format `mime_type` names.
    pub bytes: Vec<u8>,
    /// IANA media type of `bytes`, e.g. `image/png`.
    pub mime_type: String,
    /// Any commentary the model produced alongside the image.
    pub note: Option<String>,
}

impl GeneratedImage {
    /// The Macro file type for `mime_type`; `None` for a media type Macro
    /// does not know as an image.
    pub fn file_type(&self) -> Option<FileType> {
        match self.mime_type.as_str() {
            "image/png" => Some(FileType::Png),
            "image/jpeg" | "image/jpg" => Some(FileType::Jpg),
            "image/webp" => Some(FileType::Webp),
            "image/gif" => Some(FileType::Gif),
            _ => None,
        }
    }
}

/// Why an image could not be generated.
#[derive(Debug, thiserror::Error)]
pub enum ImageGenerationError {
    /// No provider is configured in this host.
    #[error("image generation is not configured")]
    Unavailable,
    /// The provider declined to render this prompt (safety filters, or the
    /// model answered in text instead of an image). The message is written
    /// for the agent that asked.
    #[error("{0}")]
    Refused(String),
    /// The provider call failed: transport, authentication, quota, or an
    /// unparseable response.
    #[error("image provider request failed")]
    Provider(#[source] anyhow::Error),
}

/// Renders an image from a text prompt.
#[async_trait::async_trait]
pub trait ImageGenerator: Send + Sync + 'static {
    /// Generate one image for `request`.
    async fn generate_image(
        &self,
        request: &ImageGenerationRequest,
    ) -> Result<GeneratedImage, ImageGenerationError>;
}

/// The generator for hosts with no image provider configured: every call
/// fails with [`ImageGenerationError::Unavailable`].
#[derive(Debug, Clone, Copy, Default)]
pub struct UnconfiguredImageGenerator;

#[async_trait::async_trait]
impl ImageGenerator for UnconfiguredImageGenerator {
    async fn generate_image(
        &self,
        _request: &ImageGenerationRequest,
    ) -> Result<GeneratedImage, ImageGenerationError> {
        Err(ImageGenerationError::Unavailable)
    }
}
