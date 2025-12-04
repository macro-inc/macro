use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_db_client::user::get_user_name::get_user_names_with_email;

use crate::api::context::ApiContext;

use model::response::ErrorResponse;
use model::user::{UserContext, UserNames};

#[derive(Default, Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct GetNamesWithEmailRequestBody {
    pub user_ids: Vec<String>,
}

/// Gets names for passed user profile ids, falling back to the requesting user's email contact names
#[utoipa::path(
    post,
    path = "/user/get_names_with_email",
    operation_id = "get_user_names_with_email",
    request_body = GetNamesWithEmailRequestBody,
    responses(
            (status = 200, body=UserNames),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
    ),
)]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<GetNamesWithEmailRequestBody>,
) -> Result<Response, Response> {
    let user_names = get_user_names_with_email(&ctx.db, &user_context.user_id, &req.user_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "failed to get user names with email");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;
    Ok((StatusCode::OK, Json(UserNames { names: user_names })).into_response())
}
