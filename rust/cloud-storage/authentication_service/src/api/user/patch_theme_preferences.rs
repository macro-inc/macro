use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;

use crate::api::context::ApiContext;

use model::{
    authentication::user::UserThemePreferences,
    response::{EmptyResponse, ErrorResponse},
    user::UserContext,
};

#[derive(thiserror::Error, Debug)]
pub enum PatchThemePreferencesError {
    #[error("User not found")]
    UserNotFound,
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for PatchThemePreferencesError {
    fn into_response(self) -> Response {
        match self {
            PatchThemePreferencesError::UserNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not found".into(),
                }),
            ),
            PatchThemePreferencesError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id".into(),
                }),
            ),
            PatchThemePreferencesError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error".into(),
                }),
            ),
        }
        .into_response()
    }
}

/// Updates the calling user's preferred light/dark themes and system-match flag.
#[utoipa::path(
        patch,
        path = "/user/theme_preferences",
        operation_id = "patch_theme_preferences",
        request_body = UserThemePreferences,
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req), err, fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<UserThemePreferences>,
) -> Result<Json<EmptyResponse>, PatchThemePreferencesError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| PatchThemePreferencesError::InvalidMacroUserId)?
        .lowercase();

    macro_db_client::user::patch::patch_user_theme_preferences(&ctx.db, &user_id, &req)
        .await
        .map_err(|e| match e.to_string().as_str() {
            "user not found" => PatchThemePreferencesError::UserNotFound,
            _ => PatchThemePreferencesError::InternalError(e),
        })?;

    Ok(Json(EmptyResponse::default()))
}
