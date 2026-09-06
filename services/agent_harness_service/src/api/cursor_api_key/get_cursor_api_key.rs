//! `GET /cursor-api-key`.

use axum::{Json, extract::State};
use bots::domain::ports::BotService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOnly};

use super::{CursorApiKeyError, CursorApiKeyState, CursorApiKeyStatus};

/// Whether the caller has a Cursor API key registered.
///
/// Never returns the key, or any part of it. There is no screen that needs one,
/// and a masked key still leaks its length and alphabet.
#[utoipa::path(
    get,
    tag = "cursor",
    path = "/cursor-api-key",
    operation_id = "get_cursor_api_key",
    responses(
        (status = 200, body = CursorApiKeyStatus),
        (status = 401, body = String),
        (status = 403, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context), err, fields(user_id = %user_context.authorization.macro_user_id))]
pub async fn handler<Bots: BotService, Auth: MacroAuthorizationService>(
    State(state): State<CursorApiKeyState<Bots, Auth>>,
    user_context: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<CursorApiKeyStatus>, CursorApiKeyError> {
    let user_id = &user_context.authorization.macro_user_id;

    // Read even when the deployment has no KMS key: a key registered before the
    // deployment lost its configuration is still stored, and reporting it as
    // absent would invite the user to paste a replacement that cannot be saved.
    let stored = cursor_api_key::store::get_cursor_api_key(&state.db, user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to read cursor api key");
            CursorApiKeyError::Internal
        })?;

    Ok(Json(CursorApiKeyStatus::from_stored(stored)))
}
