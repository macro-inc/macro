use axum::{
    Json,
    extract::{self, State},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOnly};
use utoipa::ToSchema;

use super::{CursorApiKeyError, CursorApiKeyStatus, require_macro_staff};
use crate::api::context::{ApiContext, AuthorizationService};

/// The model the user chose for their sessions.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutCursorDefaultModelRequest {
    /// A Cursor model id (e.g. `grok-4.6`), or `null` to clear the choice and
    /// fall back to the deployment default.
    pub model_id: Option<String>,
}

/// Choose the model this user's `@cursor` sessions start on.
///
/// Stores the id only; its parameters are resolved from Cursor's own default
/// variant at session start. Not validated against the live model list here —
/// the settings dropdown offers only real ids, and a stale id degrades to the
/// deployment default at spawn rather than failing, so a round trip to Cursor
/// on every save would buy nothing.
#[utoipa::path(
    put,
    path = "/cursor-api-key/default-model",
    operation_id = "put_cursor_default_model",
    request_body = PutCursorDefaultModelRequest,
    responses(
        (status = 200, body = CursorApiKeyStatus),
        (status = 401, body = String),
        (status = 403, body = model::response::ErrorResponse),
        (status = 409, body = model::response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.authorization.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: MacroAuthorizationExtractor<AuthorizationService, UserOnly>,
    extract::Json(req): extract::Json<PutCursorDefaultModelRequest>,
) -> Result<Json<CursorApiKeyStatus>, CursorApiKeyError> {
    let user_id = &user_context.authorization.macro_user_id;
    require_macro_staff(user_id)?;

    let updated = cursor_api_key::store::set_default_model_id(
        &ctx.db,
        user_id.as_ref(),
        req.model_id.as_deref(),
    )
    .await
    .map_err(|error| {
        tracing::error!(error = ?error, "failed to set cursor default model");
        CursorApiKeyError::Internal
    })?;
    // No row to update means no key: a model choice on a keyless account is
    // not representable and would be moot, so it is a "connect first", not an
    // error the user caused by a bad value.
    if !updated {
        return Err(CursorApiKeyError::NotConnected);
    }

    // Re-read rather than echo the request, so the response reflects the
    // stored truth including the untouched `updated_at`/`registered`.
    let stored = cursor_api_key::store::get_cursor_api_key(&ctx.db, user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to read cursor config after setting model");
            CursorApiKeyError::Internal
        })?;

    Ok(Json(CursorApiKeyStatus {
        registered: stored.is_some(),
        default_model_id: stored.as_ref().and_then(|s| s.default_model_id.clone()),
        updated_at: stored.map(|stored| stored.updated_at),
    }))
}
