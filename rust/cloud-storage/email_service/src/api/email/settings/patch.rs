use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
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
}

impl IntoResponse for PatchSettingsError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            PatchSettingsError::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (status_code, self.to_string()).into_response()
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
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, api_settings))]
pub async fn patch_settings_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Json(api_settings): Json<PatchSettingsRequest>,
) -> Result<Response, PatchSettingsError> {
    let service_settings = service::settings::Settings::new(api_settings.settings, link.id);

    let updated_settings =
        email_db_client::settings::patch_settings(&ctx.db, service_settings).await?;

    let response_settings = api::settings::Settings::from(updated_settings);

    Ok((
        StatusCode::OK,
        Json(PatchSettingsResponse {
            settings: response_settings,
        }),
    )
        .into_response())
}
