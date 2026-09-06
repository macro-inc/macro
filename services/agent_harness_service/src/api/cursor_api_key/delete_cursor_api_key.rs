//! `DELETE /cursor-api-key`.

use axum::{Json, extract::State};
use bots::domain::ports::BotService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOnly};

use super::{CursorApiKeyError, CursorApiKeyState, CursorApiKeyStatus};

/// Forgets the caller's Cursor API key.
///
/// This does **not** revoke the key at Cursor — it keeps working everywhere
/// else it is used, and only Cursor can revoke it. Any UI offering this has to
/// say so rather than implying otherwise.
///
/// The user's Cursor agent stays: the mention list already hides it while no
/// key is registered, and reconnecting picks the same agent, with any edits,
/// back up.
///
/// Deleting when there is nothing to delete succeeds: the caller's intent is
/// "I should have no key registered", and that is already true.
#[utoipa::path(
    delete,
    tag = "cursor",
    path = "/cursor-api-key",
    operation_id = "delete_cursor_api_key",
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

    cursor_api_key::store::delete_cursor_api_key(&state.db, user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to delete cursor api key");
            CursorApiKeyError::Internal
        })?;

    Ok(Json(CursorApiKeyStatus {
        registered: false,
        // The row is gone, model choice with it: disconnecting is a clean slate.
        default_model_id: None,
        updated_at: None,
    }))
}
