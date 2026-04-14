use crate::api::context::TokenContext;
use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_auth::headers::{AccessTokenExtractor, RefreshTokenExtractor};

/// Extracts the access token and refresh token and inserts into TokenContext
pub(in crate::api) async fn handler(
    access_token: Result<AccessTokenExtractor, StatusCode>,
    refresh_token: Result<RefreshTokenExtractor, StatusCode>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let access_token = match access_token {
        Ok(access_token) => access_token.as_ref().to_string(),
        Err(_e) => {
            return Err((StatusCode::BAD_REQUEST, "no access token to refresh").into_response());
        }
    };

    let refresh_token = match refresh_token {
        Ok(refresh_token) => refresh_token.as_ref().to_string(),
        Err(_e) => {
            return Err((StatusCode::BAD_REQUEST, "no refresh token to refresh").into_response());
        }
    };

    req.extensions_mut().insert(TokenContext {
        access_token,
        refresh_token,
    });

    Ok(next.run(req).await)
}
