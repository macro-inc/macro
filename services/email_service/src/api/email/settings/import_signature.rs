use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email_api_client::domain::models::{EmailApiError, TokenFreshness};
use email_utils::sanitize_html_fragment;
use model::response::ErrorResponse;
use models_email::service::link::Link;
use models_email::{api, service};
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
        (status = 500, body = ErrorResponse),
        (status = 502, description = "Failed to communicate with Gmail"),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn import_signature_handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
) -> Result<Json<ImportSignatureResponse>, ImportSignatureError> {
    let access_token = ctx
        .email_api
        .get_access_token(link.id, TokenFreshness::Fresh)
        .await?;

    let send_as_response = ctx
        .gmail_client
        .list_send_as(access_token.expose_secret())
        .await?;

    let aliases = send_as_response.send_as.unwrap_or_default();

    // Prefer the alias for this inbox's own address; fall back to the primary.
    let email_address = link.email_address.0.as_ref();
    let alias = aliases
        .iter()
        .find(|alias| alias.send_as_email.eq_ignore_ascii_case(email_address))
        .or_else(|| aliases.iter().find(|alias| alias.is_primary == Some(true)));

    let signature = alias
        .and_then(|alias| alias.signature.clone())
        .filter(|sig| !sig.trim().is_empty())
        .ok_or(ImportSignatureError::NoSignatureFound)?;

    let sanitized_signature = sanitize_html_fragment(&signature);

    let patch = service::settings::SettingsPatch::new(
        api::settings::Settings {
            signature: Some(sanitized_signature),
            signature_on_replies_forwards: None,
        },
        link.id,
    );

    let updated_settings = email_db_client::settings::patch_settings(&ctx.db, patch).await?;

    let response_settings = api::settings::Settings::from(updated_settings);

    Ok(Json(ImportSignatureResponse {
        settings: response_settings,
    }))
}
