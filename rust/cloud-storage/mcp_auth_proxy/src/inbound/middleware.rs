//! Bearer token middleware for the protected MCP endpoint.

use axum::{
    body::Body,
    http::{
        Request, Response, StatusCode, Uri,
        header::{HeaderValue, WWW_AUTHENTICATE},
    },
};
use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs, handler};
use macro_user_id::user_id::MacroUserIdStr;

const RESOURCE_METADATA_PATH: &str = "/.well-known/oauth-protected-resource/mcp";

fn absolute_resource_metadata_url(request: &Request<Body>) -> String {
    let scheme = request
        .headers()
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("http");
    let authority = request
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            request
                .uri()
                .authority()
                .map(|authority| authority.as_str())
        })
        .unwrap_or("localhost");

    let mut uri = Uri::builder()
        .scheme(scheme)
        .authority(authority)
        .path_and_query(RESOURCE_METADATA_PATH)
        .build()
        .expect("valid resource metadata uri")
        .to_string();

    if !uri.starts_with("http://") && !uri.starts_with("https://") {
        uri = format!("{scheme}://{authority}{RESOURCE_METADATA_PATH}");
    }

    uri
}

fn unauthorized_response(request: &Request<Body>, error: Option<&str>) -> Response<Body> {
    let resource_metadata = absolute_resource_metadata_url(request);
    let challenge = match error {
        Some(error) => {
            format!(r#"Bearer error="{error}", resource_metadata="{resource_metadata}""#)
        }
        None => format!(r#"Bearer resource_metadata="{resource_metadata}""#),
    };

    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    response.headers_mut().insert(
        WWW_AUTHENTICATE,
        HeaderValue::from_str(&challenge).expect("valid WWW-Authenticate header"),
    );
    response
}

/// Validates `Authorization: Bearer <token>` and stores the authenticated
/// [`MacroUserIdStr`] in the request extensions.
pub async fn validate_bearer(
    axum::extract::State(jwt_args): axum::extract::State<JwtValidationArgs>,
    mut request: Request<Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let token = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned);

    let Some(token) = token else {
        tracing::debug!("MCP request missing bearer token");
        return unauthorized_response(&request, None);
    };

    let jwt_token = match handler(&jwt_args, &token) {
        Ok(token) => token,
        Err(error) => {
            tracing::warn!(error=?error, "MCP bearer token validation failed");
            return unauthorized_response(&request, Some("invalid_token"));
        }
    };

    let user_id = match jwt_token {
        JwtToken::MacroAccessToken(token) => token.macro_user_id.clone(),
        JwtToken::MacroApiToken(token) => token.macro_user_id.clone(),
    };

    let user_id = match MacroUserIdStr::try_from(user_id) {
        Ok(user_id) => user_id,
        Err(error) => {
            tracing::warn!(error=?error, "MCP bearer token contained invalid macro user id");
            return unauthorized_response(&request, Some("invalid_token"));
        }
    };

    request.extensions_mut().insert(user_id);

    next.run(request).await
}
