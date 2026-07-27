use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::user::get_user_name::get_user_name;

use crate::api::context::{ApiContext, AuthorizationService};

use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use model::user::UserName;

/// Retrieves the name of a particular user.
#[utoipa::path(
        get,
        path = "/user/name",
        operation_id = "get_user_name",
        responses(
            (status = 200, body=UserName),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, authorization))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    let user_name = get_user_name(
        &ctx.db,
        &authorization.authorization.user.user_context.fusion_user_id,
    )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, user_id = %authorization.authorization.user.user_context.user_id, "failed to update user name");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;
    Ok((StatusCode::OK, Json(user_name)).into_response())
}
