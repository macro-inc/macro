use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use model::authentication::user::GetUserInfo;
use model::response::ErrorResponse;
use model::user::UserContext;

/// Gets the calling user's info
#[utoipa::path(
        get,
        path = "/user/me",
        operation_id = "get_user_info",
        responses(
            (status = 200, body=GetUserInfo),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    let permissions = macro_db_client::user::get_permissions::get_user_permissions(
        &ctx.db,
        &user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get permissions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to get user permissions",
            }),
        )
            .into_response()
    })?;

    Ok((
        StatusCode::OK,
        Json(GetUserInfo {
            user_id: user_context.user_id.clone(),
            organization_id: user_context.organization_id,
            permissions: permissions.into_iter().collect(),
        }),
    )
        .into_response())
}
