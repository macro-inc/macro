//! Creation of an image document from a text prompt.
//!
//! Generation is the [`ImageGenerator`] port; the result is stored through the
//! ordinary inline-upload lifecycle, so a generated image is a regular image
//! document with previews and indexing finished by the storage pipeline.

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use model::document::{FileType, FileTypeExt};
use model_owner::CreationPrincipal;

use super::{CreatedDocument, DocumentCreator, upload::NewFileUpload};
use crate::domain::models::DocumentError;
use crate::domain::ports::create::{DocumentBytesUploadPort, DocumentCreationService};
use crate::domain::ports::image_generation::{
    ImageAspectRatio, ImageGenerationError, ImageGenerationRequest, ImageGenerator,
};

#[cfg(test)]
mod test;

/// Longest prompt forwarded to the provider, in bytes.
pub const MAX_PROMPT_BYTES: usize = 8 * 1024;

/// An image to generate and store as a document.
pub struct NewGeneratedImage {
    /// Natural-language description of the image.
    pub prompt: String,
    /// Requested shape; the provider default when `None`.
    pub aspect_ratio: Option<ImageAspectRatio>,
    /// Document name; the extension is added from the generated format. A
    /// name that already carries an image extension keeps it.
    pub file_name: String,
    /// Edit capability for the destination project, minted for the creating
    /// principal; absent for top-level files.
    pub project: Option<EntityAccessReceipt<EditAccessLevel>>,
}

/// A generated image stored as a document.
#[derive(Debug)]
pub struct GeneratedImageDocument {
    /// The created document.
    pub document: CreatedDocument,
    /// Final filename, including its extension.
    pub file_name: String,
    /// IANA media type of the stored bytes.
    pub mime_type: String,
    /// Number of stored bytes.
    pub size_bytes: usize,
    /// Any commentary the model produced alongside the image.
    pub note: Option<String>,
}

/// Why a generated image document was not created.
#[derive(Debug, thiserror::Error)]
pub enum GenerateImageError {
    /// The image could not be generated.
    #[error(transparent)]
    Generation(#[from] ImageGenerationError),
    /// The image was generated but not stored.
    #[error(transparent)]
    Document(#[from] DocumentError),
}

impl<Svc, MarkdownInit, BytesUpload, MentionTracker>
    DocumentCreator<Svc, MarkdownInit, BytesUpload, MentionTracker>
where
    Svc: DocumentCreationService + Clone + 'static,
    BytesUpload: DocumentBytesUploadPort + Clone + 'static,
{
    /// Generate an image with `generator` and store it as an image document.
    #[tracing::instrument(skip_all, err)]
    pub async fn create_generated_image(
        &self,
        principal: &CreationPrincipal,
        generator: &dyn ImageGenerator,
        image: NewGeneratedImage,
    ) -> Result<GeneratedImageDocument, GenerateImageError> {
        let NewGeneratedImage {
            prompt,
            aspect_ratio,
            file_name,
            project,
        } = image;
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return Err(DocumentError::BadRequest("prompt must not be empty".to_string()).into());
        }
        if prompt.len() > MAX_PROMPT_BYTES {
            return Err(DocumentError::BadRequest(format!(
                "prompt exceeds the {MAX_PROMPT_BYTES} byte limit"
            ))
            .into());
        }
        let file_name = file_name.trim();
        if file_name.is_empty() {
            return Err(DocumentError::BadRequest("fileName must not be empty".to_string()).into());
        }

        let generated = generator
            .generate_image(&ImageGenerationRequest {
                prompt: prompt.to_string(),
                aspect_ratio,
            })
            .await?;
        let file_type = generated.file_type().ok_or_else(|| {
            ImageGenerationError::Provider(anyhow::anyhow!(
                "provider returned an unsupported image type {}",
                generated.mime_type
            ))
        })?;
        let file_name = with_extension(file_name, file_type);
        let size_bytes = generated.bytes.len();

        let document = self
            .upload_file(
                principal,
                NewFileUpload {
                    file_name: file_name.clone(),
                    bytes: generated.bytes,
                    project,
                },
            )
            .await?;

        Ok(GeneratedImageDocument {
            document,
            file_name,
            mime_type: generated.mime_type,
            size_bytes,
            note: generated.note,
        })
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
