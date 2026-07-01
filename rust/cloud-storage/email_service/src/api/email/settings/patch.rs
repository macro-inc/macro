use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_service::util::process_pre_insert::sfs_map;
use email_service::util::sanitizer::sanitize_html_fragment;
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
    // The signature is user-supplied HTML; sanitize at this trust boundary
    // before it is persisted (and later rendered into compose bodies).
    let mut settings = api_settings.settings;
    settings.signature = settings.signature.map(|html| sanitize_html_fragment(&html));

    // Move externally-hosted signature images onto SFS so they render durably
    // for recipients. If any image can't be fetched (e.g. Gmail/Outlook embedded
    // URLs that need that account's session, or dead links), it would render
    // broken for recipients — so reject the whole patch atomically (before any
    // write) and report the count, so the client can have the user re-add them.
    // A rehost *error* (vs. an unresolved image) never blocks the save.
    if let Some(signature) = settings.signature.clone() {
        match sfs_map::rehost_html_images(&ctx.db, &ctx.sfs_client, &signature).await {
            Ok((rehosted, unresolved)) => {
                if unresolved > 0 {
                    return Err(PatchSettingsError::UnresolvedSignatureImages(
                        unresolved as u32,
                    ));
                }
                settings.signature = Some(rehosted);
            }
            Err(e) => {
                tracing::warn!(error = ?e, "signature image rehost failed; persisting signature unchanged");
            }
        }
    }

    let patch = service::settings::SettingsPatch::new(settings, link.id);

    let updated_settings = email_db_client::settings::patch_settings(&ctx.db, patch).await?;

    let response_settings = api::settings::Settings::from(updated_settings);

    Ok(Json(PatchSettingsResponse {
        settings: response_settings,
    }))
}
