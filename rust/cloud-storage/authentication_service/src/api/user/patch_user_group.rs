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
pub struct PatchUserGroupRequest {
    /// The group to add the user to
    pub group: String,
}

#[derive(thiserror::Error, Debug)]
pub enum PatchUserGroupError {
    #[error("User not found")]
    UserNotFound,
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for PatchUserGroupError {
    fn into_response(self) -> Response {
        match self {
            PatchUserGroupError::UserNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not found",
                }),
            ),
            PatchUserGroupError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
                }),
            ),
            PatchUserGroupError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error",
                }),
            ),
        }
        .into_response()
    }
}

/// Updates the user's group.
#[utoipa::path(
        patch,
        path = "/user/group",
        operation_id = "patch_user_group",
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
    extract::Json(req): extract::Json<PatchUserGroupRequest>,
) -> Result<Json<EmptyResponse>, PatchUserGroupError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| PatchUserGroupError::InvalidMacroUserId)?
        .lowercase();

    macro_db_client::user::patch::patch_user_group(&ctx.db, &user_id, &req.group)
        .await
        .map_err(|e| match e.to_string().as_str() {
            "user not found" => PatchUserGroupError::UserNotFound,
            _ => PatchUserGroupError::InternalError(e),
        })?;

    Ok(Json(EmptyResponse::default()))
}
