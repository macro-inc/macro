//! GenerateImage renders a prompt with the configured image model and stores
//! the result as an image document.

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{BotAccessScope, EditAccessLevel, EntityType},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;
use crate::domain::{
    create::generated_image::{GenerateImageError, NewGeneratedImage},
    models::DocumentError,
    ports::{
        DocumentService,
        create::DocumentCreationService,
        editing::EditingWorkerService,
        image_generation::{ImageAspectRatio, ImageGenerationError},
    },
};

#[cfg(test)]
mod test;

// Shape of the generated image: square 1:1, landscape 4:3, portrait 3:4,
// widescreen 16:9, tall 9:16. Doc comments on the variants would turn the
// schema enum into a named type, so the ratios stay a plain comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AspectRatio {
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

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "GenerateImage",
    description = "Generate an image from a text prompt with Google's Nano Banana image model and save it as an image document in Macro. Use when the user asks for a picture, illustration, diagram concept, logo idea, mockup, or any visual to be created; do not use to edit or fetch existing images. Describe the subject, style, composition, lighting, and any text to render in the prompt. Returns the new document ID, which you can cite so the user sees the image inline. Generation takes several seconds."
)]
pub struct GenerateImage {
    #[schemars(
        description = "Detailed description of the image to generate: subject, style (photo, illustration, flat vector...), composition, colours, mood, and any text that must appear."
    )]
    pub prompt: String,
    #[schemars(
        description = "Short descriptive name for the saved image, for example `sunset-lighthouse`. The file extension is added from the generated format. No directory path."
    )]
    pub file_name: String,
    #[serde(default)]
    #[schemars(
        description = "Shape of the image. Omit for the model default (square). `widescreen` (16:9) suits banners and slides, `tall` (9:16) suits phone screens and stories."
    )]
    pub aspect_ratio: Option<AspectRatio>,
    #[serde(default)]
    #[schemars(
        description = "Optional destination project (folder) ID. Requires edit access. Omit to save to the user's top-level files."
    )]
    pub project_id: Option<uuid::Uuid>,
}

/// Where the generated image landed. Does not echo the image bytes.
#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageResponse {
    /// ID of the new image document.
    pub document_id: String,
    /// Saved filename, including its extension.
    pub file_name: String,
    /// IANA media type of the image, e.g. `image/png`.
    pub mime_type: String,
    /// Size of the image in bytes.
    pub size_bytes: usize,
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
        GenerateImageError::Generation(ImageGenerationError::Unavailable) => {
            "image generation is not available in this workspace".to_string()
        }
        GenerateImageError::Generation(ImageGenerationError::Refused(reason)) => {
            format!("the image model did not return an image: {reason}")
        }
        GenerateImageError::Generation(ImageGenerationError::Provider(_)) => {
            "the image model request failed; try again shortly".to_string()
        }
        GenerateImageError::Document(DocumentError::BadRequest(message)) => message.clone(),
        GenerateImageError::Document(DocumentError::NameTooLong { max }) => {
            format!("fileName is too long (maximum {max} characters)")
        }
        GenerateImageError::Document(DocumentError::Unauthorized) => {
            "you need edit access to the destination project".to_string()
        }
        GenerateImageError::Document(_) => {
            "the image was generated but could not be saved to Macro".to_string()
        }
    };
    ToolCallError {
        description,
        internal_error: error.into(),
    }
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for GenerateImage
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = GenerateImageResponse;

    async fn call(
        &self,
        service_context: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let project = match self.project_id {
            Some(project_id) => Some(
                service_context
                    .entity_access_service
                    .generate_bot_entity_access_receipt::<EditAccessLevel>(
                        service_context.actor,
                        BotAccessScope::user(request_context.user_id.clone()),
                        &project_id.to_string(),
                        EntityType::Project,
                    )
                    .await
                    .map_err(|error| ToolCallError {
                        description:
                            "you need edit access to the destination project, or it does not exist"
                                .to_string(),
                        internal_error: error.into(),
                    })?,
            ),
            None => None,
        };
        let created = service_context
            .creator
            .create_generated_image(
                &service_context.creation_principal(request_context.user_id),
                service_context.image_generator.as_ref(),
                NewGeneratedImage {
                    prompt: self.prompt.clone(),
                    aspect_ratio: self.aspect_ratio.map(Into::into),
                    file_name: self.file_name.clone(),
                    project,
                },
            )
            .await
            .map_err(generate_error)?;

        Ok(GenerateImageResponse {
            document_id: created.document.document_id().to_string(),
            file_name: created.file_name,
            mime_type: created.mime_type,
            size_bytes: created.size_bytes,
            note: created.note,
        })
    }
}
