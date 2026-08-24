use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserId;

use super::{CursorApiKeyError, CursorApiKeyStatus};
use crate::api::context::{ApiContext, AuthorizationService};

/// Forgets the caller's Cursor API key.
///
/// This does **not** revoke the key at Cursor — it keeps working everywhere
/// else it is used, and only Cursor can revoke it. Any UI offering this has to
/// say so rather than implying otherwise.
///
/// Deleting when there is nothing to delete succeeds: the caller's intent is
/// "I should have no key registered", and that is already true.
#[utoipa::path(
    delete,
    path = "/cursor-api-key",
    operation_id = "delete_cursor_api_key",
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

    cursor_api_key::store::delete_cursor_api_key(&ctx.db, user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to delete cursor api key");
            CursorApiKeyError::Internal
        })?;

    Ok(Json(CursorApiKeyStatus {
        registered: false,
        updated_at: None,
    }))
}
