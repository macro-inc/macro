//! Prompt validation, naming, and generation-to-document orchestration.
use super::models::{
    GenerateImageError, GeneratedImageDocument, ImageGenerationError, ImageGenerationRequest,
    MAX_PROMPT_BYTES, MAX_REFERENCE_BYTES, MAX_REFERENCE_IMAGES, NewGeneratedImage,
    NewImageDocument,
};
use super::ports::{
    ImageDocumentStore, ImageGenerationService, ImageGenerator, ImageReferenceReader,
    UnconfiguredImageReferenceReader,
};
use model::document::{FileType, FileTypeExt};
use model_owner::CreationPrincipal;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Image generation use case composed from a model provider and document store.
pub struct ImageGenerationServiceImpl<Store, References = UnconfiguredImageReferenceReader> {
    generator: Arc<dyn ImageGenerator>,
    store: Store,
    references: References,
}

impl<Store> ImageGenerationServiceImpl<Store> {
    /// Compose the provider and document-saving capability.
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

impl<Store: ImageDocumentStore, References: ImageReferenceReader> ImageGenerationService
    for ImageGenerationServiceImpl<Store, References>
{
    /// Generate an image and store it through the document-saving port.
    #[tracing::instrument(skip_all, err)]
    async fn create_generated_image(
        &self,
        principal: &CreationPrincipal,
        image: NewGeneratedImage,
    ) -> Result<GeneratedImageDocument, GenerateImageError> {
        let NewGeneratedImage {
            prompt,
            aspect_ratio,
            file_name,
            project,
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
        let file_name = match file_name.as_deref().map(str::trim) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => file_name_from_prompt(prompt),
        };

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
        let file_type = generated.file_type().ok_or_else(|| {
            ImageGenerationError::Provider(anyhow::anyhow!(
                "provider returned an unsupported image type {}",
                generated.mime_type
            ))
        })?;
        let file_name = with_extension(&file_name, file_type);
        let size_bytes = generated.bytes.len();

        let document_id = self
            .store
            .save_image(
                principal,
                NewImageDocument {
                    file_name: file_name.clone(),
                    bytes: generated.bytes,
                    project,
                },
            )
            .await?;

        Ok(GeneratedImageDocument {
            document_id,
            file_name,
            mime_type: generated.mime_type,
            size_bytes,
            note: generated.note,
        })
    }
}

/// Words of `prompt` used as the document name when the caller gave none.
const FILE_NAME_WORDS: usize = 6;

/// A document name from the opening words of `prompt`: letters, digits, and
/// plain hyphens only, so the name needs no further filename validation.
fn file_name_from_prompt(prompt: &str) -> String {
    let name = prompt
        .split(|c: char| !(c.is_alphanumeric() || c == '-'))
        .filter(|word| !word.is_empty())
        .take(FILE_NAME_WORDS)
        .collect::<Vec<_>>()
        .join(" ");
    if name.is_empty() {
        "Generated image".to_string()
    } else {
        name
    }
}

/// `name` with `file_type`'s extension, unless it already ends in an image
/// extension the storage pipeline recognises.
fn with_extension(name: &str, file_type: FileType) -> String {
    let lower = name.to_ascii_lowercase();
    let already_image = FileType::split_suffix_match(&lower)
        .and_then(|(_, extension)| extension.parse::<FileType>().ok())
        .is_some_and(|existing| existing.is_image());
    if already_image {
        name.to_string()
    } else {
        format!("{name}.{}", file_type.as_str())
    }
}
