use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::{ApiContext, AuthorizationService};

use macro_authorization::MacroAuthorizationExtractor;
use model::authentication::user::GetUserInfo;
use model::response::ErrorResponse;

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
#[tracing::instrument(skip(ctx, authorization), fields(user_id=%authorization.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService>,
) -> Result<Response, Response> {
    let permissions = macro_db_client::user::get_permissions::get_user_permissions(
        &ctx.db,
        authorization.macro_user_id.as_ref(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get permissions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                message: "unable to get user permissions".into(),
            }),
        )
            .into_response()
    })?;

    Ok((
        StatusCode::OK,
        Json(GetUserInfo {
            user_id: authorization.macro_user_id.to_string(),
            organization_id: authorization.user_context.organization_id,
            permissions: permissions.into_iter().collect(),
        }),
    )
        .into_response())
}
