//! OAuth 2.1 proxy for the MCP server.
//!
//! Exposes OAuth endpoints that Claude talks to, proxying the actual
//! authentication to FusionAuth behind the scenes.

pub mod handlers;
pub mod middleware;
pub mod state;
pub mod tool_service;

use axum::{Router, middleware as axum_mw, routing};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use state::OAuthState;

/// Health check handler for ALB.
async fn health() -> &'static str {
    "ok"
}

/// Build the complete router for the MCP server: OAuth routes (unauthenticated)
/// merged with the `/mcp` route (Bearer-authenticated).
pub fn mcp_router<S>(oauth_state: OAuthState, jwt_args: JwtValidationArgs, mcp_service: S) -> Router
where
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    // OAuth routes — no auth required.
    let oauth_routes = Router::new()
        .route("/health", routing::get(health))
        .route(
            "/.well-known/oauth-authorization-server",
            routing::get(handlers::metadata),
        )
        .route("/authorize", routing::get(handlers::authorize))
        .route("/register", routing::post(handlers::register))
        .route("/oauth/callback", routing::get(handlers::oauth_callback))
        .route("/token", routing::post(handlers::token))
        .with_state(oauth_state);

    // MCP route — protected by Bearer token middleware.
    let mcp_route =
        Router::new()
            .nest_service("/mcp", mcp_service)
            .layer(axum_mw::from_fn_with_state(
                jwt_args,
                middleware::validate_bearer,
            ));

    oauth_routes.merge(mcp_route)
}
