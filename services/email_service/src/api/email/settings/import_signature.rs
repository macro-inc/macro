use crate::api::context::ApiContext;
use crate::api::email::settings::patch::UnresolvedSignatureImagesError;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email::domain::signature_settings::SignatureImportError;
use email_api_client::domain::models::EmailApiError;
use model::response::ErrorResponse;
use models_email::api;
use models_email::service::link::Link;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum ImportSignatureError {
    #[error("No signature found in Gmail")]
    NoSignatureFound,
    #[error("Failed to fetch Gmail signature")]
    GmailApiError(#[from] gmail_client::GmailApiHttpError),
    #[error("Failed to get Gmail access token")]
    TokenError(#[from] EmailApiError),
    #[error("Failed to update settings")]
    DatabaseError(#[from] anyhow::Error),
    /// At least one Gmail signature image couldn't be fetched and would render
    /// broken for recipients, so nothing is saved (same rule as `patch.rs`).
    #[error("{0} signature image(s) could not be loaded")]
    UnresolvedSignatureImages(u32),
}

impl IntoResponse for ImportSignatureError {
    fn into_response(self) -> Response {
        match self {
            ImportSignatureError::NoSignatureFound => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            ImportSignatureError::GmailApiError(_) | ImportSignatureError::TokenError(_) => {
                (StatusCode::BAD_GATEWAY, self.to_string()).into_response()
            }
            ImportSignatureError::DatabaseError(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()).into_response()
            }
            ImportSignatureError::UnresolvedSignatureImages(count) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(UnresolvedSignatureImagesError {
                    unresolved_image_count: count,
                }),
            )
                .into_response(),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ImportSignatureResponse {
    pub settings: api::settings::Settings,
}

/// Import the user's email signature from Gmail.
#[utoipa::path(
    post,
    tag = "Settings",
    path = "/email/settings/import-signature",
    operation_id = "import_signature",
    responses(
        (status = 200, body = ImportSignatureResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, description = "No signature found in Gmail"),
        (status = 422, body = UnresolvedSignatureImagesError),
        (status = 500, body = ErrorResponse),
        (status = 502, description = "Failed to communicate with Gmail"),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn import_signature_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
) -> Result<Json<ImportSignatureResponse>, ImportSignatureError> {
    let updated_settings = ctx
        .signature_settings
        .import(link.id, link.email_address.0.as_ref())
        .await
        .map_err(|error| match error {
            SignatureImportError::NoSignature => ImportSignatureError::NoSignatureFound,
            SignatureImportError::Token(error) => ImportSignatureError::TokenError(error),
            SignatureImportError::Provider(error) => ImportSignatureError::GmailApiError(error),
            SignatureImportError::Database(error) => {
                ImportSignatureError::DatabaseError(error.into_inner())
            }
            SignatureImportError::UnresolvedImages(count) => {
                ImportSignatureError::UnresolvedSignatureImages(count)
            }
        })?;
    Ok(Json(ImportSignatureResponse {
        settings: api::settings::Settings::from(updated_settings),
    }))
}
