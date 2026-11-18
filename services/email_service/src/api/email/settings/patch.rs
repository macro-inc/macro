use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email::domain::signature_settings::SettingsPatchError;
use model::response::ErrorResponse;
use models_email::service::link::Link;
use models_email::{api, service};
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum PatchSettingsError {
    #[error("Failed to update settings")]
    DatabaseError(#[from] anyhow::Error),
    /// At least one signature image couldn't be fetched (e.g. pasted from
    /// another webmail account, so reachable only by that session) and would
    /// render broken for recipients. The whole patch is rejected atomically —
    /// nothing is persisted — so the client can have the user re-add them.
    #[error("{0} signature image(s) could not be loaded")]
    UnresolvedSignatureImages(u32),
}

/// Body returned with a 422 when signature images can't be loaded.
#[derive(Debug, serde::Serialize, ToSchema)]
pub struct UnresolvedSignatureImagesError {
    pub unresolved_image_count: u32,
}

impl IntoResponse for PatchSettingsError {
    fn into_response(self) -> Response {
        match self {
            PatchSettingsError::DatabaseError(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()).into_response()
            }
            PatchSettingsError::UnresolvedSignatureImages(count) => (
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
pub struct PatchSettingsRequest {
    pub settings: api::settings::Settings,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct PatchSettingsResponse {
    pub settings: api::settings::Settings,
}

/// Patch user settings.
#[utoipa::path(
    patch,
    tag = "Settings",
    path = "/email/settings",
    operation_id = "patch_settings",
    request_body = PatchSettingsRequest,
    responses(
        (status = 200, body = PatchSettingsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 422, body = UnresolvedSignatureImagesError),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, api_settings))]
pub async fn patch_settings_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Json(api_settings): Json<PatchSettingsRequest>,
) -> Result<Json<PatchSettingsResponse>, PatchSettingsError> {
    let patch = service::settings::SettingsPatch::new(api_settings.settings, link.id);
    let updated_settings =
        ctx.signature_settings
            .patch(patch)
            .await
            .map_err(|error| match error {
                SettingsPatchError::Database(error) => {
                    PatchSettingsError::DatabaseError(error.into_inner())
                }
                SettingsPatchError::UnresolvedImages(count) => {
                    PatchSettingsError::UnresolvedSignatureImages(count)
                }
            })?;
    Ok(Json(PatchSettingsResponse {
        settings: api::settings::Settings::from(updated_settings),
    }))
}
