//! Prompt validation and generation-to-static-file orchestration.
use super::models::{
    GenerateImageError, ImageGenerationError, ImageGenerationRequest, MAX_PROMPT_BYTES,
    MAX_REFERENCE_BYTES, MAX_REFERENCE_IMAGES, NewGeneratedImage, NewStaticImage,
    StoredGeneratedImage,
};
use super::ports::{
    ImageGenerationService, ImageGenerator, ImageReferenceReader, ImageStore,
    UnconfiguredImageReferenceReader,
};
use model_owner::CreationPrincipal;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Image generation use case composed from a model provider and static file store.
pub struct ImageGenerationServiceImpl<Store, References = UnconfiguredImageReferenceReader> {
    generator: Arc<dyn ImageGenerator>,
    store: Store,
    references: References,
}

impl<Store> ImageGenerationServiceImpl<Store> {
    /// Compose the provider and image-saving capability.
    pub fn new(generator: Arc<dyn ImageGenerator>, store: Store) -> Self {
        Self {
            generator,
            store,
            references: UnconfiguredImageReferenceReader,
        }
    }
}

impl<Store, References> ImageGenerationServiceImpl<Store, References> {
    /// Enable reference photos using the owning domains' read capabilities.
    pub fn with_reference_reader<R>(self, references: R) -> ImageGenerationServiceImpl<Store, R> {
        ImageGenerationServiceImpl {
            generator: self.generator,
            store: self.store,
            references,
        }
    }
}

impl<Store: ImageStore, References: ImageReferenceReader> ImageGenerationService
    for ImageGenerationServiceImpl<Store, References>
{
    /// Generate an image and store it through the image-saving port.
    #[tracing::instrument(skip_all, err)]
    async fn create_generated_image(
        &self,
        principal: &CreationPrincipal,
        image: NewGeneratedImage,
    ) -> Result<StoredGeneratedImage, GenerateImageError> {
        let NewGeneratedImage {
            prompt,
            aspect_ratio,
            reference_images,
        } = image;
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Err(GenerateImageError::BadRequest(
                "prompt must not be empty".to_string(),
            ));
        }
        if prompt.len() > MAX_PROMPT_BYTES {
            return Err(GenerateImageError::BadRequest(format!(
                "prompt exceeds the {MAX_PROMPT_BYTES} byte limit"
            )));
        }
        if reference_images.len() > MAX_REFERENCE_IMAGES {
            return Err(GenerateImageError::BadRequest(format!(
                "referenceImages accepts at most {MAX_REFERENCE_IMAGES} images"
            )));
        }
        let mut references = Vec::with_capacity(reference_images.len());
        let mut reference_bytes = 0;
        for reference in &reference_images {
            let image = self.references.read_image(principal, reference).await?;
            if image.bytes.is_empty()
                || !matches!(
                    image.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                )
            {
                return Err(GenerateImageError::BadRequest(
                    "referenceImages must contain readable PNG, JPEG, or WebP images".to_string(),
                ));
            }
            if image.bytes.len() > MAX_REFERENCE_BYTES - reference_bytes {
                return Err(GenerateImageError::BadRequest(
                    "reference images exceed the 12 MiB total limit; use smaller images"
                        .to_string(),
                ));
            }
            reference_bytes += image.bytes.len();
            references.push(image);
        }

        let generated = self
            .generator
            .generate_image(&ImageGenerationRequest {
                prompt: prompt.to_string(),
                aspect_ratio,
                reference_images: references,
            })
            .await?;
        generated.file_type().ok_or_else(|| {
            ImageGenerationError::Provider(anyhow::anyhow!(
                "provider returned an unsupported image type {}",
                generated.mime_type
            ))
        })?;
        if generated.bytes.is_empty() {
            return Err(ImageGenerationError::Provider(anyhow::anyhow!(
                "provider returned an empty image"
            ))
            .into());
        }
        let size_bytes = generated.bytes.len();

        let static_file = self
            .store
            .save_image(NewStaticImage {
                mime_type: generated.mime_type.clone(),
                bytes: generated.bytes,
            })
            .await?;

        Ok(StoredGeneratedImage {
            static_file,
            mime_type: generated.mime_type,
            size_bytes,
            note: generated.note,
        })
    }
}
