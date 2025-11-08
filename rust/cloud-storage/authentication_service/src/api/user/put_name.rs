use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::user::update_user_name::update_user_name;

use crate::api::context::ApiContext;

use model::response::EmptyResponse;
use model::response::ErrorResponse;
use model::user::{PutUserNameQueryParams, UserContext};

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
#[tracing::instrument(skip(ctx, user_context), fields(user_id = user_context.user_id, macro_user_id = user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Query(params): Query<PutUserNameQueryParams>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    tracing::info!("put_user_name");

    update_user_name(
        &ctx.db,
        &user_context.fusion_user_id,
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
