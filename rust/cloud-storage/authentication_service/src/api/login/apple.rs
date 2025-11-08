use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use tower_cookies::Cookies;

use crate::api::{
    context::ApiContext,
    utils::{create_access_token_cookie, create_refresh_token_cookie},
};

use model::{
    authentication::login::request::AppleLoginRequest,
    response::{EmptyResponse, ErrorResponse},
};

/// Completes the apple login flow
#[utoipa::path(
        post,
        operation_id = "apple_login",
        path = "/login/apple",
        responses(
            (status = 200, body = EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, cookies))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    cookies: Cookies,
    extract::Json(req): extract::Json<AppleLoginRequest>,
) -> Result<Response, Response> {
    tracing::trace!("apple login request");

    let identity_provider_id = ctx
        .auth_client
        .get_identity_provider_id_by_name("Apple")
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to find idp id for Apple");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to find idp",
                }),
            )
                .into_response()
        })?;

    let (access_token, refresh_token) = ctx
        .auth_client
        .apple_login(&identity_provider_id, &req.id_token, &req.code)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to complete apple login");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to complete apple login",
                }),
            )
                .into_response()
        })?;

    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
