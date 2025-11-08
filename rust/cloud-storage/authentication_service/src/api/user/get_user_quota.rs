use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use roles_and_permissions::domain::model::PermissionId;
use user_quota::UserQuota;

use crate::api::context::ApiContext;

use model::response::ErrorResponse;
use model::user::UserContext;

/// Retrieves the users quota.
/// Returns NO_CONTENT if the user is a premium user with no quota.
#[utoipa::path(
        get,
        path = "/user/quota",
        operation_id = "get_user_quota",
        responses(
            (status = 200, body=UserQuota),
            (status = 204),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    if let Some(permissions) = user_context.permissions.as_ref() {
        // If the user if premium, return NO_CONTENT
        if permissions.contains(&PermissionId::ReadProfessionalFeatures.to_string()) {
            return Ok((StatusCode::NO_CONTENT).into_response());
        }

        let user_id = MacroUserId::parse_from_str(&user_context.user_id)
            .map_err(|e| {
                tracing::error!(error=?e, user_id=?user_context.user_id, "unable to parse user id");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to parse user id",
                    }),
                )
                    .into_response()
            })?
            .lowercase();

        let quota = macro_db_client::user_quota::get_user_quota(&ctx.db, &user_id)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, user_id=?user_context.user_id, "unable to get user quota");
                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
            })?;

        Ok((StatusCode::OK, Json(quota)).into_response())
    } else {
        Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "no permissions were found for user",
            }),
        )
            .into_response())
    }
}
