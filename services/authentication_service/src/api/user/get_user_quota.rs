use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::PermissionedMacroAuthorizationExtractor;
use roles_and_permissions::domain::model::PermissionId;
use user_quota::UserQuota;

use crate::api::context::ApiContext;

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
#[tracing::instrument(skip(ctx, authorization), fields(user_id=?authorization.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: PermissionedMacroAuthorizationExtractor,
) -> Result<Response, Response> {
    if authorization
        .permissions
        .contains(&PermissionId::ReadProfessionalFeatures)
    {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }

    let quota = macro_db_client::user_quota::get_user_quota(
        &ctx.db,
        &authorization.macro_user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, user_id=?authorization.user_context.user_id, "unable to get user quota");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;

    Ok((StatusCode::OK, Json(quota)).into_response())
}
