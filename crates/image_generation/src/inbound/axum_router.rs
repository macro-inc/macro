//! HTTP adapter for generating an image as the authenticated caller.

use crate::domain::{
    models::{
        GenerateImageError, ImageAspectRatio, ImageGenerationError, ImageReference,
        NewGeneratedImage, ReadImageError, StoredGeneratedImage,
    },
    ports::ImageGenerationService,
};
use ai_billing::inbound::admission::admission_status;
use axum::{
    Json, Router,
    extract::{FromRef, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Shape of the generated image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GenerateImageAspectRatio {
    /// 1:1, the model default.
    Square,
    /// 4:3.
    Landscape,
    /// 3:4.
    Portrait,
    /// 16:9, for banners and slides.
    Widescreen,
    /// 9:16, for phone screens and stories.
    Tall,
}

impl From<GenerateImageAspectRatio> for ImageAspectRatio {
    fn from(value: GenerateImageAspectRatio) -> Self {
        match value {
            GenerateImageAspectRatio::Square => Self::Square,
            GenerateImageAspectRatio::Landscape => Self::Landscape,
            GenerateImageAspectRatio::Portrait => Self::Portrait,
            GenerateImageAspectRatio::Widescreen => Self::Widescreen,
            GenerateImageAspectRatio::Tall => Self::Tall,
        }
    }
}

/// A reference image already stored in Macro.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GenerateImageReference {
    /// An image document the caller can view.
    Document {
        /// The Macro document ID.
        id: uuid::Uuid,
    },
    /// An uploaded or previously generated static file.
    StaticFile {
        /// The static file ID.
        id: uuid::Uuid,
    },
}

impl From<GenerateImageReference> for ImageReference {
    fn from(value: GenerateImageReference) -> Self {
        match value {
            GenerateImageReference::Document { id } => Self::Document(id),
            GenerateImageReference::StaticFile { id } => Self::StaticFile(id),
        }
    }
}

/// What image to generate.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageRequest {
    /// Description of the image: subject, style, composition, colours, and any text to render.
    pub prompt: String,
    /// Shape of the image; the model default (square) when omitted.
    #[serde(default)]
    pub aspect_ratio: Option<GenerateImageAspectRatio>,
    /// Up to three reference images, in the order the prompt refers to them.
    #[serde(default)]
    pub reference_images: Vec<GenerateImageReference>,
}

/// The stored generated image.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GenerateImageResponse {
    /// Static file ID, reusable as a reference image or a message attachment.
    pub static_file_id: uuid::Uuid,
    /// Permanent URL of the image.
    pub url: String,
    /// IANA media type of the image, e.g. `image/png`.
    pub mime_type: String,
    /// Size of the image in bytes.
    pub size_bytes: u64,
    /// Intrinsic pixel width.
    pub width: u32,
    /// Intrinsic pixel height.
    pub height: u32,
    /// Commentary the model produced alongside the image, when any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl From<StoredGeneratedImage> for GenerateImageResponse {
    fn from(image: StoredGeneratedImage) -> Self {
        Self {
            static_file_id: image.static_file.id,
            url: image.static_file.url,
            mime_type: image.mime_type,
            size_bytes: image.size_bytes as u64,
            width: image.width,
            height: image.height,
            note: image.note,
        }
    }
}

/// Sanitized, machine-readable failure of an image request.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct GenerateImageErrorBody {
    /// Explanation without provider or storage diagnostics.
    pub error: String,
    /// Stable failure code.
    pub code: String,
}

/// An HTTP status with its [`GenerateImageErrorBody`].
pub struct GenerateImageFailure {
    status: StatusCode,
    body: GenerateImageErrorBody,
}

impl GenerateImageFailure {
    fn new(status: StatusCode, code: &str, error: String) -> Self {
        Self {
            status,
            body: GenerateImageErrorBody {
                error,
                code: code.to_owned(),
            },
        }
    }
}

impl From<GenerateImageError> for GenerateImageFailure {
    fn from(error: GenerateImageError) -> Self {
        let (status, code) = match &error {
            GenerateImageError::BadRequest(_) => (StatusCode::BAD_REQUEST, "invalid_image_request"),
            GenerateImageError::Reference(ReadImageError::Unauthorized) => {
                (StatusCode::FORBIDDEN, "reference_not_accessible")
            }
            GenerateImageError::Reference(ReadImageError::NotImage) => {
                (StatusCode::BAD_REQUEST, "reference_not_image")
            }
            GenerateImageError::Reference(ReadImageError::Unavailable)
            | GenerateImageError::Generation(ImageGenerationError::Unavailable) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "image_generation_unavailable",
            ),
            GenerateImageError::Reference(ReadImageError::Internal(_)) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "reference_read_failed")
            }
            GenerateImageError::Generation(ImageGenerationError::Refused(_)) => {
                (StatusCode::UNPROCESSABLE_ENTITY, "image_refused")
            }
            GenerateImageError::Generation(ImageGenerationError::Provider(_)) => {
                (StatusCode::BAD_GATEWAY, "image_provider_error")
            }
            GenerateImageError::Storage(_) | GenerateImageError::Markup(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "image_storage_failed")
            }
            GenerateImageError::Admission(admission) => {
                (admission_status(*admission), admission.code())
            }
            GenerateImageError::UserRequired => (StatusCode::FORBIDDEN, "user_required"),
        };
        if status.is_server_error() {
            tracing::error!(error = ?error, code, "image generation failed");
        }
        Self::new(status, code, error.public_message())
    }
}

impl IntoResponse for GenerateImageFailure {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

/// Router state: the use case and what the caller extractors need.
pub struct ImageGenerationRouterState<Svc, Auth> {
    /// Image generation, admitted against the caller's AI allowance.
    pub service: Arc<Svc>,
    /// Authenticates callers.
    pub authorization_state: MacroAuthorizationState<Auth>,
    /// Whether a team bot with no acting user may create.
    pub non_user_owners: NonUserOwners,
}

impl<Svc, Auth> Clone for ImageGenerationRouterState<Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
            non_user_owners: self.non_user_owners,
        }
    }
}

impl<Svc, Auth> FromRef<ImageGenerationRouterState<Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ImageGenerationRouterState<Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

impl<Svc, Auth> FromRef<ImageGenerationRouterState<Svc, Auth>> for NonUserOwners {
    fn from_ref(state: &ImageGenerationRouterState<Svc, Auth>) -> Self {
        state.non_user_owners
    }
}

/// `POST /images/generate`.
pub fn image_generation_router<Svc, Auth, S>(
    state: ImageGenerationRouterState<Svc, Auth>,
) -> Router<S>
where
    Svc: ImageGenerationService + 'static,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route(
            "/images/generate",
            post(generate_image_handler::<Svc, Auth>),
        )
        .with_state(state)
}

/// Generate an image with Nano Banana and store it as a static file owned by
/// the caller. Charged to the acting user's AI allowance.
#[utoipa::path(
    post,
    path = "/images/generate",
    operation_id = "generate_image",
    tag = "images",
    request_body = GenerateImageRequest,
    responses(
        (status = 200, description = "The stored image", body = GenerateImageResponse),
        (status = 400, description = "Invalid prompt or reference", body = GenerateImageErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "AI allowance exhausted", body = GenerateImageErrorBody),
        (status = 403, description = "A reference is not accessible, or no user to bill", body = GenerateImageErrorBody),
        (status = 422, description = "The model declined to render the prompt", body = GenerateImageErrorBody),
        (status = 500, description = "The image could not be read or stored", body = GenerateImageErrorBody),
        (status = 502, description = "The image model request failed", body = GenerateImageErrorBody),
        (status = 503, description = "Image generation or usage validation unavailable", body = GenerateImageErrorBody),
    )
)]
#[tracing::instrument(
    name = "image_generation.http",
    skip_all,
    fields(
        reference_count = tracing::field::Empty,
        static_file_id = tracing::field::Empty,
    )
)]
pub async fn generate_image_handler<
    Svc: ImageGenerationService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<ImageGenerationRouterState<Svc, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    request: Result<Json<GenerateImageRequest>, JsonRejection>,
) -> Result<Json<GenerateImageResponse>, GenerateImageFailure> {
    let Json(request) = request.map_err(|rejection| {
        GenerateImageFailure::new(
            StatusCode::BAD_REQUEST,
            "invalid_image_request",
            rejection.body_text(),
        )
    })?;
    let span = tracing::Span::current();
    span.record("reference_count", request.reference_images.len());
    let image = state
        .service
        .create_generated_image(
            &principal,
            NewGeneratedImage {
                prompt: request.prompt,
                aspect_ratio: request.aspect_ratio.map(Into::into),
                reference_images: request
                    .reference_images
                    .into_iter()
                    .map(Into::into)
                    .collect(),
            },
        )
        .await?;
    span.record(
        "static_file_id",
        tracing::field::display(image.static_file.id),
    );
    Ok(Json(image.into()))
}
