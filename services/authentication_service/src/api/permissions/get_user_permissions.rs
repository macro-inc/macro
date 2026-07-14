use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use macro_authorization::SharedMacroAuthorizationExtractor;

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
#[tracing::instrument(skip(ctx, auth), fields(user_id=%auth.macro_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    auth: SharedMacroAuthorizationExtractor,
) -> Result<Response, Response> {
    let permissions = macro_db_client::user::get_permissions::get_user_permissions(
        &ctx.db,
        &auth.user_context.user_id,
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
