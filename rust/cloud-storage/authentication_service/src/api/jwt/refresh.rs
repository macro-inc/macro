use crate::{
    api::{
        context::TokenContext,
        utils::{create_access_token_cookie, create_refresh_token_cookie},
    },
    service::fusionauth_client::{FusionAuthClient, error::FusionAuthClientError},
};
use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_auth::{error::MacroAuthError, middleware::decode_jwt::JwtValidationArgs};
use model::response::UserTokensResponse;
use std::sync::Arc;
use tower_cookies::Cookies;

/// Refreshes a JWT token
/// You can either have your access token and refresh token in the cookies or in the request
/// headers
/// Authorization: Bearer <access_token>
/// x-macro-refresh-token: <refresh_token>
/// This returns the cookies with the new access and refresh token
#[utoipa::path(
        post,
        operation_id = "refresh",
        path = "/jwt/refresh",
        responses(
            (status = 200, body = UserTokensResponse),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(auth_client, jwt, token_context, cookies))]
pub async fn handler(
    State(auth_client): State<Arc<FusionAuthClient>>,
    State(jwt): State<JwtValidationArgs>,
    token_context: Extension<TokenContext>,
    cookies: Cookies,
) -> Result<Response, Response> {
    match macro_auth::middleware::decode_jwt::validate_macro_access_token(
        &token_context.access_token,
        &jwt,
    ) {
        Ok(_) => {
            // jwt is valid, return back original tokens
            return Ok((
                StatusCode::OK,
                Json(UserTokensResponse {
                    access_token: token_context.access_token.clone(),
                    refresh_token: token_context.refresh_token.clone(),
                }),
            )
                .into_response());
        }
        Err(e) => match e {
            // We only want to refresh the token if it's expired
            MacroAuthError::JwtExpired => {}
            _ => {
                tracing::error!(error=?e, "unable to decode jwt");
                return Err((StatusCode::UNAUTHORIZED, "unauthorized").into_response());
            }
        },
    }

    let (access_token, refresh_token) = auth_client
        .refresh_token(&token_context.access_token, &token_context.refresh_token)
        .await
        .map_err(|e| match e {
            FusionAuthClientError::InvalidRefreshToken => {
                (StatusCode::BAD_REQUEST, "invalid refresh token").into_response()
            }
            _ => {
                tracing::error!(error=?e, "unable to refresh token");
                (StatusCode::INTERNAL_SERVER_ERROR).into_response()
            }
        })?;

    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    Ok((
        StatusCode::OK,
        Json(UserTokensResponse {
            access_token,
            refresh_token,
        }),
    )
        .into_response())
}
