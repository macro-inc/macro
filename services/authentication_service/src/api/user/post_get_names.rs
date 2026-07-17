use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{InternalMacroAuthorizationExtractor, MacroAuthorizationExtractor};
use macro_db_client::user::get_user_name::get_user_names;

use crate::api::context::{ApiContext, AuthorizationService};

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
#[tracing::instrument(skip(ctx, _authorization))]
pub async fn handler_external(
    State(ctx): State<ApiContext>,
    _authorization: MacroAuthorizationExtractor<AuthorizationService>,
    extract::Json(req): extract::Json<PostGetNamesRequestBody>,
) -> Result<Response, Response> {
    lookup_names(&ctx, req).await
}

pub async fn handler_internal(
    State(ctx): State<ApiContext>,
    _internal_authorization: InternalMacroAuthorizationExtractor<AuthorizationService>,
    extract::Json(req): extract::Json<PostGetNamesRequestBody>,
) -> Result<Response, Response> {
    lookup_names(&ctx, req).await
}

async fn lookup_names(
    ctx: &ApiContext,
    req: PostGetNamesRequestBody,
) -> Result<Response, Response> {
    let user_names = get_user_names(&ctx.db, &req.user_ids).await.map_err(|e| {
        tracing::error!(error=?e, "failed to update user name");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;

    Ok((StatusCode::OK, Json(UserNames { names: user_names })).into_response())
}
