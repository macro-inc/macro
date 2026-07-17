use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::MacroAuthorizationExtractor;

use crate::api::context::{ApiContext, AuthorizationService};

/// Gets a list of the users permissions
#[utoipa::path(
        get,
        path = "/permissions/me",
        operation_id = "get_user_permissions",
        responses(
            (status = 200, body=Vec<String>),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=%authorization.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService>,
) -> Result<Response, Response> {
    let permissions = macro_db_client::user::get_permissions::get_user_permissions(
        &ctx.db,
        &authorization.user_context.user_id,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get permissions");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get permissions",
        )
            .into_response()
    })?;

    Ok((StatusCode::OK, Json(permissions)).into_response())
}
