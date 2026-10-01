//! Inbound image-generation service and outbound provider/storage capabilities.
use super::models::{
    GenerateImageError, GeneratedImage, GeneratedImageDocument, ImageGenerationError,
    ImageGenerationRequest, ImageReference, NewGeneratedImage, NewImageDocument, ReadImageError,
    ReferenceImage, SaveImageError,
};
use model_owner::CreationPrincipal;
use std::future::Future;
use uuid::Uuid;

/// Renders an image from a text prompt and optional reference photos.
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

/// Saves generated image bytes through the owning document domain.
pub trait ImageDocumentStore: Send + Sync {
    /// Store a document using the caller's identity and verified destination.
    fn save_image(
        &self,
        principal: &CreationPrincipal,
        image: NewImageDocument,
    ) -> impl Future<Output = Result<Uuid, SaveImageError>> + Send;
}

/// Inbound port for generating an image and saving it as a Macro document.
pub trait ImageGenerationService: Send + Sync {
    /// Generate and persist an image for the creating principal.
    fn create_generated_image(
        &self,
        principal: &CreationPrincipal,
        image: NewGeneratedImage,
    ) -> impl Future<Output = Result<GeneratedImageDocument, GenerateImageError>> + Send;
}
