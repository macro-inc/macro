use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;

use crate::api::context::ApiContext;

use model::{
    authentication::user::UserThemePreferences, response::ErrorResponse, user::UserContext,
};

#[derive(thiserror::Error, Debug)]
pub enum GetThemePreferencesError {
    #[error("User not found")]
    UserNotFound,
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for GetThemePreferencesError {
    fn into_response(self) -> Response {
        match self {
            GetThemePreferencesError::UserNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not found".into(),
                }),
            ),
            GetThemePreferencesError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id".into(),
                }),
            ),
            GetThemePreferencesError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error".into(),
                }),
            ),
        }
        .into_response()
    }
}

/// Gets the calling user's preferred light/dark themes and system-match flag.
#[utoipa::path(
        get,
        path = "/user/theme_preferences",
        operation_id = "get_theme_preferences",
        responses(
            (status = 200, body=UserThemePreferences),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Json<UserThemePreferences>, GetThemePreferencesError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| GetThemePreferencesError::InvalidMacroUserId)?
        .lowercase();

    let prefs = macro_db_client::user::get::get_user_theme_preferences(&ctx.db, &user_id)
        .await
        .map_err(|e| match e.to_string().as_str() {
            "user not found" => GetThemePreferencesError::UserNotFound,
            _ => GetThemePreferencesError::InternalError(e),
        })?;

    Ok(Json(prefs))
}
