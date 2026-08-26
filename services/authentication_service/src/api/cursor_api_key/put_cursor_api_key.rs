use axum::{
    Json,
    extract::{self, State},
};
use cursor_api_key::cipher::CursorApiKey;
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};
use utoipa::ToSchema;

use super::{CursorApiKeyError, CursorApiKeyStatus, require_macro_staff};
use crate::api::context::{ApiContext, AuthorizationService};

/// The key the user pasted.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutCursorApiKeyRequest {
    /// A `crsr_…` Cursor API key.
    pub api_key: String,
}

/// Registers or replaces the caller's Cursor API key.
///
/// The key is validated on shape alone — this cannot distinguish a live key
/// from forty random characters behind the right prefix. Confirming it against
/// Cursor's `GET /v1/me` is the obvious improvement, and is what would let this
/// report the connected account rather than only that a key exists.
#[utoipa::path(
    put,
    path = "/cursor-api-key",
    operation_id = "put_cursor_api_key",
    request_body = PutCursorApiKeyRequest,
    responses(
        (status = 200, body = CursorApiKeyStatus),
        (status = 400, body = model::response::ErrorResponse),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
    )
)]
// `req` is skipped: it is the key itself, and an instrumented span field would
// write a live credential into every trace.
#[tracing::instrument(skip(ctx, user_context, req), err, fields(user_id = %user_context.authorization.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOnly>,
    extract::Json(req): extract::Json<PutCursorApiKeyRequest>,
) -> Result<Json<CursorApiKeyStatus>, CursorApiKeyError> {
    let user_id = &user_context.authorization.macro_user_id;
    require_macro_staff(user_id)?;

    let cipher = &ctx.cursor_api_key_cipher;

    // Parsed before anything else, so a malformed key never reaches KMS.
    let key = CursorApiKey::parse(&req.api_key).map_err(|_| CursorApiKeyError::MalformedKey)?;
    let encrypted = cipher
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
        cursor_api_key::store::upsert_cursor_api_key(&ctx.db, user_id.as_ref(), &encrypted)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "failed to store cursor api key");
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
