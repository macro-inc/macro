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
pub struct PatchUserOnboardingRequest {
    /// The first name of the user
    pub first_name: String,
    /// The last name of the user
    pub last_name: String,
    /// The title of the user
    pub title: String,
    /// The industry of the user
    pub industry: String,
}

#[derive(thiserror::Error, Debug)]
pub enum PatchUserOnboardingError {
    #[error("User not found")]
    UserNotFound,
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for PatchUserOnboardingError {
    fn into_response(self) -> Response {
        match self {
            PatchUserOnboardingError::UserNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not found",
                }),
            ),
            PatchUserOnboardingError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
                }),
            ),
            PatchUserOnboardingError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error",
                }),
            ),
        }
        .into_response()
    }
}

/// Updates the user's onboarding.
#[utoipa::path(
        patch,
        path = "/user/onboarding",
        operation_id = "patch_user_onboarding",
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
    extract::Json(req): extract::Json<PatchUserOnboardingRequest>,
) -> Result<Json<EmptyResponse>, PatchUserOnboardingError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| PatchUserOnboardingError::InvalidMacroUserId)?
        .lowercase();

    macro_db_client::user::patch::patch_user_onboarding(
        &ctx.db,
        &user_id,
        &macro_db_client::user::patch::UserOnboarding {
            first_name: &req.first_name,
            last_name: &req.last_name,
            title: &req.title,
            industry: &req.industry,
        },
    )
    .await
    .map_err(|e| match e.to_string().as_str() {
        "user not found" => PatchUserOnboardingError::UserNotFound,
        _ => PatchUserOnboardingError::InternalError(e),
    })?;

    Ok(Json(EmptyResponse::default()))
}
