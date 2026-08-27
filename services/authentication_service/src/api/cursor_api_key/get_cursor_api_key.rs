use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};

use super::{CursorApiKeyError, CursorApiKeyStatus, require_macro_staff};
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
        (status = 403, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.authorization.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOnly>,
) -> Result<Json<CursorApiKeyStatus>, CursorApiKeyError> {
    let user_id = &user_context.authorization.macro_user_id;
    require_macro_staff(user_id)?;

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
        default_model_id: stored.as_ref().and_then(|s| s.default_model_id.clone()),
        updated_at: stored.map(|stored| stored.updated_at),
    }))
}
