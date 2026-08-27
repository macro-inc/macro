use axum::{Json, extract::State};
use cursor_cloud_agents::api::{ApiKey, CursorClient, CursorConfig};
use cursor_cloud_agents::domain::ports::CursorAgents;
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};
use utoipa::ToSchema;

use super::{CursorApiKeyError, require_macro_staff};
use crate::api::context::{ApiContext, AuthorizationService};

/// One model the settings dropdown can offer.
///
/// Just id and name: the dropdown lists models, not the hundreds of parameter
/// variants each carries. The chosen id's parameters are resolved to Cursor's
/// default variant at session start.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CursorModelOption {
    /// The id to store and send, e.g. `grok-4.6`.
    pub id: String,
    /// The human-readable name, e.g. `Cursor Grok 4.6`.
    pub display_name: String,
}

/// The models this account may choose from.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CursorModelsResponse {
    /// The offered models, in the order Cursor returned them.
    pub models: Vec<CursorModelOption>,
}

/// List the models the caller's Cursor account offers.
///
/// Reached only from the settings dropdown, so it decrypts the user's own key
/// and asks Cursor directly — the list is per-account and changes, so there is
/// nothing to cache statically. Reuses the harness's Cursor client rather than
/// reimplementing the `/v1/models` parse, keeping one source of truth for what
/// a model is.
#[utoipa::path(
    get,
    path = "/cursor-api-key/models",
    operation_id = "list_cursor_models",
    responses(
        (status = 200, body = CursorModelsResponse),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
        (status = 409, body = model::response::ErrorResponse),
        (status = 502, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.authorization.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOnly>,
) -> Result<Json<CursorModelsResponse>, CursorApiKeyError> {
    let user_id = &user_context.authorization.macro_user_id;
    require_macro_staff(user_id)?;

    let stored = cursor_api_key::store::get_cursor_api_key(&ctx.db, user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to read cursor config");
            CursorApiKeyError::Internal
        })?
        .ok_or(CursorApiKeyError::NotConnected)?;

    let key = ctx
        .cursor_api_key_cipher
        .decrypt(user_id.as_ref(), &stored.encrypted)
        .await
        .map_err(|error| {
            // Opaque on the way out for the same reason the harness keeps it
            // so: the variants can distinguish a wrong encryption context from
            // KMS being down, which is a probing signal.
            tracing::error!(error = ?error, "failed to decrypt cursor api key");
            CursorApiKeyError::Internal
        })?;

    let client = CursorClient::new(CursorConfig {
        api_key: ApiKey::new(key.expose()),
        base_url: cursor_cloud_agents::api::CURSOR_API_BASE_URL.to_owned(),
        model: None,
        starting_ref: "main".to_owned(),
        record_dir: None,
    })
    .map_err(|error| {
        tracing::error!(error = %error, "a stored cursor api key is unusable");
        CursorApiKeyError::Internal
    })?;

    let models = client.list_models().await.map_err(|error| {
        tracing::warn!(error = %error, "could not list cursor models");
        CursorApiKeyError::CursorUnavailable
    })?;

    Ok(Json(CursorModelsResponse {
        models: models
            .into_iter()
            .map(|model| CursorModelOption {
                id: model.id,
                display_name: model.display_name,
            })
            .collect(),
    }))
}
