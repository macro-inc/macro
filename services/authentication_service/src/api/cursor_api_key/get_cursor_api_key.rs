use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserId;

use super::{CursorApiKeyError, CursorApiKeyStatus};
use crate::api::context::{ApiContext, AuthorizationService};

/// Whether the caller has a Cursor API key registered.
///
/// Never returns the key, or any part of it. There is no screen that needs one,
/// and a masked key still leaks its length and alphabet.
#[utoipa::path(
    get,
    path = "/cursor-api-key",
    operation_id = "get_cursor_api_key",
    responses(
        (status = 200, body = CursorApiKeyStatus),
        (status = 401, body = String),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = user_context.authorization.user.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Json<CursorApiKeyStatus>, CursorApiKeyError> {
    let user_id =
        MacroUserId::parse_from_str(&user_context.authorization.user.user_context.user_id)
            .map_err(|_| CursorApiKeyError::InvalidMacroUserId)?
            .lowercase();

    // Read even when the deployment has no KMS key: a key registered before the
    // deployment lost its configuration is still stored, and reporting it as
    // absent would invite the user to paste a replacement that cannot be saved.
    let stored = cursor_api_key::store::get_cursor_api_key(&ctx.db, user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to read cursor api key");
            CursorApiKeyError::Internal
        })?;

    Ok(Json(CursorApiKeyStatus {
        registered: stored.is_some(),
        available: ctx.cursor_api_key_cipher.is_some(),
        updated_at: stored.map(|stored| stored.updated_at),
    }))
}
