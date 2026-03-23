use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::IntoResponse,
};
use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs, handler};

/// Validated user identity extracted from the Bearer token.
#[derive(Clone, Debug)]
pub struct McpUserIdentity {
    /// The macro user id (e.g. `macro|user@example.com`).
    pub user_id: String,
    /// The raw JWT string (some downstream code still needs it).
    pub jwt: String,
}

/// Axum middleware that validates the `Authorization: Bearer <token>` header
/// and inserts an [`McpUserIdentity`] into request extensions.
pub async fn validate_bearer(
    axum::extract::State(jwt_args): axum::extract::State<JwtValidationArgs>,
    mut request: Request<Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let token = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_owned());

    let Some(token) = token else {
        return StatusCode::UNAUTHORIZED.into_response();
    };

    let jwt_token = match handler(&jwt_args, &token) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(error=?e, "MCP bearer token validation failed");
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };

    let user_id = match &jwt_token {
        JwtToken::MacroAccessToken(t) => t.macro_user_id.clone(),
        JwtToken::MacroApiToken(t) => t.macro_user_id.clone(),
    };

    request.extensions_mut().insert(McpUserIdentity {
        user_id,
        jwt: token,
    });

    next.run(request).await
}
