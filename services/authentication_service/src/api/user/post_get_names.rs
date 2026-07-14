use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::user::get_user_name::get_user_names;
use macro_middleware::auth::internal_access::ValidInternalKey;

use crate::api::context::ApiContext;

use model::response::ErrorResponse;
use model::user::UserNames;

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct PostGetNamesRequestBody {
    pub user_ids: Vec<String>,
}

/// Retrieves user names in bulk
#[utoipa::path(
        post,
        path = "/user/get_names",
        operation_id = "get_user_names",
        responses(
            (status = 200, body=UserNames),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx))]
pub async fn handler_external(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<PostGetNamesRequestBody>,
) -> Result<Response, Response> {
    let user_names = get_user_names(&ctx.db, &req.user_ids).await.map_err(|e| {
        tracing::error!(error=?e, "failed to update user name");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;
    Ok((StatusCode::OK, Json(UserNames { names: user_names })).into_response())
}

pub async fn handler_internal(
    ctx: State<ApiContext>,
    _valid_access: ValidInternalKey,
    req: extract::Json<PostGetNamesRequestBody>,
) -> Result<Response, Response> {
    handler_external(ctx, req).await
}
