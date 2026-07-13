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
pub struct PatchAiConsentRequest {
    /// Whether the user has consented to AI data sharing
    pub ai_data_consent: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum PatchAiConsentError {
    #[error("User not found")]
    UserNotFound,
    #[error("unable to parse user id")]
    InvalidMacroUserId,
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for PatchAiConsentError {
    fn into_response(self) -> Response {
        match self {
            PatchAiConsentError::UserNotFound => (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "user not found".into(),
                }),
            ),
            PatchAiConsentError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id".into(),
                }),
            ),
            PatchAiConsentError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error".into(),
                }),
            ),
        }
        .into_response()
    }
}

/// Updates the user's AI data consent flag.
#[utoipa::path(
        patch,
        path = "/user/ai_consent",
        operation_id = "patch_ai_consent",
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
    extract::Json(req): extract::Json<PatchAiConsentRequest>,
) -> Result<Json<EmptyResponse>, PatchAiConsentError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| PatchAiConsentError::InvalidMacroUserId)?
        .lowercase();

    macro_db_client::user::patch::patch_ai_consent(&ctx.db, &user_id, req.ai_data_consent)
        .await
        .map_err(|e| match e.to_string().as_str() {
            "user not found" => PatchAiConsentError::UserNotFound,
            _ => PatchAiConsentError::InternalError(e),
        })?;

    Ok(Json(EmptyResponse::default()))
}
