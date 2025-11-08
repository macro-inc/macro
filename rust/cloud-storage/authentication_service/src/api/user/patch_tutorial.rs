use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;

use crate::api::context::ApiContext;

use model::{
    response::{EmptyResponse, ErrorResponse},
    user::UserContext,
};
use utoipa::ToSchema;

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchUserTutorialRequest {
    /// If the user has completed the tutorial
    pub tutorial_complete: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum PatchTutorialCompleteError {
    #[error("User not found")]
    UserNotFound,
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for PatchTutorialCompleteError {
    fn into_response(self) -> Response {
        match self {
            PatchTutorialCompleteError::UserNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not found",
                }),
            ),
            PatchTutorialCompleteError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
                }),
            ),
            PatchTutorialCompleteError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error",
                }),
            ),
        }
        .into_response()
    }
}

/// Updates the user's tutorialComplete flag.
#[utoipa::path(
        patch,
        path = "/user/tutorial",
        operation_id = "patch_user_tutorial",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id=user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<PatchUserTutorialRequest>,
) -> Result<Json<EmptyResponse>, PatchTutorialCompleteError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| PatchTutorialCompleteError::InvalidMacroUserId)?
        .lowercase();

    macro_db_client::user::patch::patch_user_tutorial(&ctx.db, &user_id, req.tutorial_complete)
        .await
        .map_err(|e| match e.to_string().as_str() {
            "user not found" => PatchTutorialCompleteError::UserNotFound,
            _ => PatchTutorialCompleteError::InternalError(e),
        })?;

    Ok(Json(EmptyResponse::default()))
}
