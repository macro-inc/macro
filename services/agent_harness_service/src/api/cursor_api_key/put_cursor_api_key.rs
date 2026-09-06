//! `PUT /cursor-api-key`.

use axum::{
    Json,
    extract::{self, State},
};
use bots::domain::ports::BotService;
use cursor_api_key::cipher::CursorApiKey;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOnly};
use utoipa::ToSchema;

use super::{CursorApiKeyError, CursorApiKeyState, CursorApiKeyStatus, list_cursor_models};

/// The key the user pasted.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutCursorApiKeyRequest {
    /// A `crsr_…` Cursor API key.
    pub api_key: String,
}

/// Registers or replaces the caller's Cursor API key and makes sure the
/// caller has their private Cursor agent.
///
/// The agent is what `@cursor` resolves to: a user-owned, all-channels agent on
/// the `cursor` harness, created once and reused on every later registration.
/// Its model is seeded from the user's stored default when they have chosen
/// one, otherwise from the first model the account offers; it is theirs to
/// change under Settings → Agents afterwards.
///
/// Pasting a key that Cursor does not honour fails here rather than at the
/// first session: the model listing is the one call that proves the key works.
#[utoipa::path(
    put,
    tag = "cursor",
    path = "/cursor-api-key",
    operation_id = "put_cursor_api_key",
    request_body = PutCursorApiKeyRequest,
    responses(
        (status = 200, body = CursorApiKeyStatus),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = String),
        (status = 403, body = model_error_response::ErrorResponse),
        (status = 502, body = model_error_response::ErrorResponse),
    )
)]
// `req` is skipped: it is the key itself, and an instrumented span field would
// write a live credential into every trace.
#[tracing::instrument(skip(state, user_context, req), err, fields(user_id = %user_context.authorization.macro_user_id))]
pub async fn handler<Bots: BotService, Auth: MacroAuthorizationService>(
    State(state): State<CursorApiKeyState<Bots, Auth>>,
    user_context: MacroAuthorizationExtractor<Auth, UserOnly>,
    extract::Json(req): extract::Json<PutCursorApiKeyRequest>,
) -> Result<Json<CursorApiKeyStatus>, CursorApiKeyError> {
    let user_id = user_context.authorization.macro_user_id;

    // Parsed before anything else, so a malformed key never reaches KMS.
    let key = CursorApiKey::parse(&req.api_key).map_err(|_| CursorApiKeyError::MalformedKey)?;
    // Listed before anything is stored: a key Cursor rejects is not one worth
    // keeping, and the first model is what seeds the agent below.
    let models = list_cursor_models::models_for_key(&state.cursor_api_base_url, &key).await?;

    let encrypted = state
        .cipher
        .encrypt(user_id.as_ref(), key)
        .await
        .map_err(|error| {
            // The error is logged but not returned: its variants can tell a
            // caller whether the encryption context was wrong, which is a
            // probing signal.
            tracing::error!(error = ?error, "failed to encrypt cursor api key");
            CursorApiKeyError::Internal
        })?;

    let stored =
        cursor_api_key::store::upsert_cursor_api_key(&state.db, user_id.as_ref(), &encrypted)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "failed to store cursor api key");
                CursorApiKeyError::Internal
            })?;

    let default_model = match stored.default_model_id.clone() {
        Some(model) => model,
        None => models
            .into_iter()
            .next()
            .map(|model| model.id)
            .ok_or(CursorApiKeyError::NoModels)?,
    };
    state
        .bots
        .ensure_cursor_agent(user_id, default_model)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to ensure the user's cursor agent");
            CursorApiKeyError::Internal
        })?;

    Ok(Json(CursorApiKeyStatus {
        registered: true,
        // Carried through: pasting a rotated key does not reset the model,
        // and the store preserves it, so the response reflects that.
        default_model_id: stored.default_model_id,
        updated_at: Some(stored.updated_at),
    }))
}
