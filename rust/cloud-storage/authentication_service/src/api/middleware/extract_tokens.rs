use crate::api::context::TokenContext;
use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_auth::error::MacroAuthError;

// Extracts the access token and refresh token and inserts into TokenContext
pub(in crate::api) async fn handler(mut req: Request, next: Next) -> Result<Response, Response> {
    let headers = req.headers();
    let access_token = match macro_auth::headers::extract_access_token_from_request_headers(headers)
    {
        Ok(access_token) => access_token,
        Err(e) => match e {
            MacroAuthError::NoAccessTokenProvided => {
                return Err((StatusCode::BAD_REQUEST, "no access token to refresh").into_response());
            }
            _ => {
                tracing::error!(error=?e, "unable to extract access token from request headers");
                return Err((StatusCode::INTERNAL_SERVER_ERROR).into_response());
            }
        },
    };

    let refresh_token = match macro_auth::headers::extract_refresh_token_from_request_headers(
        headers,
    ) {
        Ok(refresh_token) => refresh_token,
        Err(e) => match e {
            MacroAuthError::NoRefreshTokenProvided => {
                tracing::error!(error=?e, "missing refresh token");
                return Err(
                    (StatusCode::BAD_REQUEST, "no refresh token to refresh").into_response()
                );
            }
            _ => {
                tracing::error!(error=?e, "unable to extract refresh token from request headers");
                return Err((StatusCode::INTERNAL_SERVER_ERROR).into_response());
            }
        },
    };

    req.extensions_mut().insert(TokenContext {
        access_token,
        refresh_token,
    });

    Ok(next.run(req).await)
}
