use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use roles_and_permissions::domain::model::PermissionId;
use user_quota::UserQuota;

use crate::api::{context::ApiContext, permissions_extractor::DbPermissionsExtractor};

use model::response::ErrorResponse;

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
#[tracing::instrument(skip(ctx, db_permissions), fields(user_id=?db_permissions.authorization.authorization.user.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    db_permissions: DbPermissionsExtractor,
) -> Result<Response, Response> {
    let user_context = &db_permissions.authorization.authorization.user.user_context;

    // If the user is premium, return NO_CONTENT.
    if db_permissions
        .permissions
        .contains(&PermissionId::ReadProfessionalFeatures.to_string())
    {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }

    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|e| {
            tracing::error!(error=?e, user_id=?user_context.user_id, "unable to parse user id");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to parse user id".into(),
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
}
