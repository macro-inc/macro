use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::user::update_user_name::update_user_name;

use crate::api::context::{ApiContext, AuthorizationService};

use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::EmptyResponse;
use model::response::ErrorResponse;
use model::user::PutUserNameQueryParams;

/// Sets the name of a particular user
#[utoipa::path(
        put,
        path = "/user/name",
        operation_id = "put_user_name",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
        params(PutUserNameQueryParams),
    )]
#[tracing::instrument(skip(ctx, authorization), fields(user_id = authorization.authorization.user.user_context.user_id, macro_user_id = authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Query(params): Query<PutUserNameQueryParams>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    tracing::info!("put_user_name");

    update_user_name(
        &ctx.db,
        &authorization.authorization.user.user_context.fusion_user_id,
        params.first_name,
        params.last_name,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "failed to update user name");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;
    Ok((StatusCode::OK, Json(EmptyResponse {})).into_response())
}
