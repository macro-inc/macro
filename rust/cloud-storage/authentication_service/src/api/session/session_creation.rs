use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use tower_cookies::Cookies;

use crate::api::{
    context::{ApiContext, TokenContext},
    utils::generate_session_code,
};

use model::response::{EmptyResponse, ErrorResponse};

/// Refreshes a JWT token
#[utoipa::path(
        post,
        operation_id = "session_creation",
        path = "/session",
        responses(
            (status = 200, body = EmptyResponse),
            (status = 400, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, token_context))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    token_context: Extension<TokenContext>,
    cookies: Cookies,
) -> Result<Response, Response> {
    let session_code = generate_session_code();
    ctx.macro_cache_client
        .set_mobile_login_session(&session_code, &token_context.refresh_token)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to set mobile login session");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to store session code",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
