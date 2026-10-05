//! Inbound image-generation service and outbound provider/storage capabilities.
use super::models::{
    GenerateImageError, GeneratedImage, ImageGenerationError, ImageGenerationRequest,
    ImageReference, NewGeneratedImage, NewStaticImage, ReadImageError, ReferenceImage,
    SaveImageError, StoredGeneratedImage, StoredImage,
};
use ai_usage::{UsageContext, UsageRecorder};
use model_owner::CreationPrincipal;
use std::future::Future;

/// Renders an image from a text prompt and optional reference photos.
#[async_trait::async_trait]
pub trait ImageGenerator: Send + Sync + 'static {
    /// Generate one image for `request`, recording provider-reported usage even
    /// when the response cannot be turned into an image.
    async fn generate_image(
        &self,
        request: &ImageGenerationRequest,
        usage: &UsageContext,
        recorder: &dyn UsageRecorder,
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
        _usage: &UsageContext,
        _recorder: &dyn UsageRecorder,
    ) -> Result<GeneratedImage, ImageGenerationError> {
        Err(ImageGenerationError::Unavailable)
    }
}

/// Loads reference photos through their owning domains' inbound services.
pub trait ImageReferenceReader: Send + Sync {
    /// Resolve one image, checking document access for the creating principal.
    fn read_image(
        &self,
        principal: &CreationPrincipal,
        reference: &ImageReference,
    ) -> impl Future<Output = Result<ReferenceImage, ReadImageError>> + Send;
}

/// Reference reader for hosts that only support text-to-image generation.
#[derive(Debug, Clone, Copy, Default)]
pub struct UnconfiguredImageReferenceReader;

impl ImageReferenceReader for UnconfiguredImageReferenceReader {
    async fn read_image(
        &self,
        _principal: &CreationPrincipal,
        _reference: &ImageReference,
    ) -> Result<ReferenceImage, ReadImageError> {
        Err(ReadImageError::Unavailable)
    }
}

/// Saves generated image bytes to static file service.
pub trait ImageStore: Send + Sync {
    /// Upload image bytes and return their permanent location.
    fn save_image(
        &self,
        image: NewStaticImage,
    ) -> impl Future<Output = Result<StoredImage, SaveImageError>> + Send;
}

/// Inbound port for generating an image and saving it as a static file.
pub trait ImageGenerationService: Send + Sync {
    /// Generate and persist an image for the creating principal.
    fn create_generated_image(
        &self,
        principal: &CreationPrincipal,
        image: NewGeneratedImage,
    ) -> impl Future<Output = Result<StoredGeneratedImage, GenerateImageError>> + Send;
}

/// Composes saved images using the editor's serialization contract.
#[async_trait::async_trait]
pub trait ImageMarkdownComposer: Send + Sync {
    /// Return channel markup that preserves the intrinsic image dimensions.
    async fn compose_image(
        &self,
        image: &StoredImage,
        width: u32,
        height: u32,
    ) -> Result<String, super::models::ComposeImageError>;
}
