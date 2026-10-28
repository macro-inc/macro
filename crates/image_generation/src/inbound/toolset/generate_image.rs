//! GenerateImage renders a prompt with the configured image model and stores
//! the result in static file service.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::ImageGenerationToolContext;
use crate::domain::{
    models::{
        GenerateImageError, ImageAspectRatio, ImageGenerationError, ImageReference,
        NewGeneratedImage, ReadImageError, StoredGeneratedImage,
    },
    ports::ImageGenerationService,
};
use model_owner::CreationPrincipal;

#[cfg(test)]
mod test;

// Shape of the generated image: square 1:1, landscape 4:3, portrait 3:4,
// widescreen 16:9, tall 9:16. Doc comments on the variants would turn the
// schema enum into a named type, so the ratios stay a plain comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum AspectRatio {
    Square,
    Landscape,
    Portrait,
    Widescreen,
    Tall,
}

impl From<AspectRatio> for ImageAspectRatio {
    fn from(value: AspectRatio) -> Self {
        match value {
            AspectRatio::Square => Self::Square,
            AspectRatio::Landscape => Self::Landscape,
            AspectRatio::Portrait => Self::Portrait,
            AspectRatio::Widescreen => Self::Widescreen,
            AspectRatio::Tall => Self::Tall,
        }
    }
}

/// A reference photo already stored in Macro.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ImageReferenceInput {
    /// An image document the user can view.
    Document {
        /// The Macro document ID.
        id: uuid::Uuid,
    },
    /// An uploaded photo or a previously generated static image.
    StaticFile {
        /// Uploaded file ID from the /file/<id> segment of its attachment URL.
        id: uuid::Uuid,
    },
}

impl From<ImageReferenceInput> for ImageReference {
    fn from(value: ImageReferenceInput) -> Self {
        match value {
            ImageReferenceInput::Document { id } => Self::Document(id),
            ImageReferenceInput::StaticFile { id } => Self::StaticFile(id),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "GenerateImage",
    description = "Generate or edit an image with Google's Nano Banana image model and save the result in static file service. Use for pictures, illustrations, diagram concepts, logo ideas, mockups, or edits based on reference photos. When the user supplies photos or asks to modify an existing image, pass them in referenceImages; describing a photo in the prompt alone does not send it to the image model. Describe the subject, style, composition, lighting, and any text to render; only the prompt is required. Refer to reference images by their order (image 1, image 2, image 3) when explaining how to use them. Returns the static file ID and image URL. The tool displays the image inline in chat. In channel messages without tool cards, copy the returned markdown verbatim on its own line; it includes dimensions so the image reserves space before loading. Do not cite it as a document. Generation takes several seconds."
)]
/// Generate an image and save it as a static file.
pub struct GenerateImage {
    #[schemars(
        description = "Detailed description of the image to generate: subject, style (photo, illustration, flat vector...), composition, colours, mood, and any text that must appear."
    )]
    prompt: String,
    #[serde(default)]
    #[schemars(
        description = "Shape of the image. Omit for the model default (square). `widescreen` (16:9) suits banners and slides, `tall` (9:16) suits phone screens and stories."
    )]
    aspect_ratio: Option<AspectRatio>,
    #[serde(default)]
    #[schemars(
        description = "Up to three reference photos, in the order used by the prompt. Use type document with a Macro image document ID, or type staticFile with the UUID from /file/<id> in an uploaded attachment's source URL or the staticFileId of a previous generation. Use the actual IDs supplied in the conversation or by tools; do not invent IDs. Omit for text-only generation.",
        length(max = 3)
    )]
    reference_images: Option<Vec<ImageReferenceInput>>,
}

/// Where the generated image landed. Does not echo the image bytes.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageResponse {
    /// ID of the static file, reusable in referenceImages.
    pub static_file_id: String,
    /// Permanent URL of the generated image.
    pub url: String,
    /// IANA media type of the image, e.g. `image/png`.
    pub mime_type: String,
    /// Size of the image in bytes.
    pub size_bytes: usize,
    /// Intrinsic pixel width. Absent only in historical tool results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Intrinsic pixel height. Absent only in historical tool results.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// Ready-to-send channel image markup with dimensions. Copy verbatim on its own line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markdown: Option<String>,
    /// Commentary the model produced alongside the image, when any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl ToolAnnotated for GenerateImage {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::additive("Generate image").with_open_world();
}

fn generate_error(error: GenerateImageError) -> ToolCallError {
    let description = match &error {
        GenerateImageError::BadRequest(message) => message.clone(),
        GenerateImageError::Reference(ReadImageError::Internal(_)) => {
            "could not read a reference image; check its ID and access, then retry".to_string()
        }
        GenerateImageError::Reference(error) => error.to_string(),
        GenerateImageError::Generation(ImageGenerationError::Unavailable) => {
            "image generation is not available in this workspace".to_string()
        }
        GenerateImageError::Generation(ImageGenerationError::Refused(reason)) => {
            format!("the image model did not return an image: {reason}")
        }
        GenerateImageError::Generation(ImageGenerationError::Provider(_)) => {
            "the image model request failed; try again shortly".to_string()
        }
        GenerateImageError::Markup(_) => {
            "the image was saved but its channel markup could not be composed".to_string()
        }
        GenerateImageError::Storage(_) => {
            "the image was generated but could not be saved to Macro".to_string()
        }
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

#[async_trait]
impl<Svc> AsyncTool<ImageGenerationToolContext<Svc>> for GenerateImage
where
    Svc: ImageGenerationService + 'static,
{
    type Output = GenerateImageResponse;

    async fn call(
        &self,
        service_context: ServiceContext<ImageGenerationToolContext<Svc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let created = service_context
            .service
            .create_generated_image(
                &CreationPrincipal::BotForUser {
                    bot: service_context.actor,
                    user: request_context.user_id,
                },
                NewGeneratedImage {
                    prompt: self.prompt.clone(),
                    aspect_ratio: self.aspect_ratio.map(Into::into),
                    reference_images: self
                        .reference_images
                        .iter()
                        .flatten()
                        .copied()
                        .map(Into::into)
                        .collect(),
                },
            )
            .await
            .map_err(generate_error)?;

        Ok(created.into())
    }
}

impl From<StoredGeneratedImage> for GenerateImageResponse {
    fn from(created: StoredGeneratedImage) -> Self {
        Self {
            static_file_id: created.static_file.id.to_string(),
            url: created.static_file.url,
            mime_type: created.mime_type,
            size_bytes: created.size_bytes,
            width: Some(created.width),
            height: Some(created.height),
            markdown: Some(created.markdown),
            note: created.note,
        }
    }
}
