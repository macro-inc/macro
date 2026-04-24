//! Axum router for the MCP OAuth broker.

use std::time::Duration;

use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderName, Method, header},
    middleware as axum_mw,
    response::{IntoResponse, Json, Redirect, Response},
    routing,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::domain::{
    models::{AuthorizeRequest, CallbackRequest, TokenRequest},
    service::{
        CompleteCallbackError, InflightAuthStore, McpAuthProxyService, McpAuthProxyServiceImpl,
        StartAuthorizationError, TokenExchangeError,
    },
};

/// Health check handler for ALB.
async fn health() -> &'static str {
    "ok"
}

async fn authorization_server_metadata<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
) -> Json<serde_json::Value> {
    Json(auth_proxy.authorization_server_metadata())
}

async fn protected_resource_metadata<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
) -> Json<serde_json::Value> {
    Json(auth_proxy.protected_resource_metadata())
}

async fn register<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(auth_proxy.register_client(body))
}

async fn authorize<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    Query(params): Query<AuthorizeRequest>,
) -> Response {
    match auth_proxy.start_authorization(params).await {
        Ok(url) => Redirect::temporary(&url).into_response(),
        Err(StartAuthorizationError::UnsupportedResponseType) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported response_type",
        )
            .into_response(),
        Err(StartAuthorizationError::UnsupportedCodeChallengeMethod) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported code_challenge_method",
        )
            .into_response(),
        Err(StartAuthorizationError::InvalidRedirectUri) => (
            axum::http::StatusCode::BAD_REQUEST,
            "redirect_uri must be https or a loopback address",
        )
            .into_response(),
        Err(StartAuthorizationError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to persist inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to persist inflight auth state",
            )
                .into_response()
        }
        Err(StartAuthorizationError::ConstructAuthorizeUrl(error)) => {
            tracing::error!(error=?error, "failed to construct upstream authorize URL");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to construct authorize URL",
            )
                .into_response()
        }
    }
}

async fn oauth_callback<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    Query(params): Query<CallbackRequest>,
) -> Response {
    match auth_proxy.complete_callback(params).await {
        Ok(url) => Redirect::temporary(&url).into_response(),
        Err(CompleteCallbackError::MissingState) => {
            tracing::warn!("no state parameter in upstream OAuth callback");
            (
                axum::http::StatusCode::BAD_REQUEST,
                "missing state parameter",
            )
                .into_response()
        }
        Err(CompleteCallbackError::MissingCode) => {
            tracing::warn!("upstream OAuth callback missing both code and error");
            (
                axum::http::StatusCode::BAD_REQUEST,
                "missing code parameter",
            )
                .into_response()
        }
        Err(CompleteCallbackError::UnknownOrExpiredSession) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unknown or expired session",
        )
            .into_response(),
        Err(CompleteCallbackError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access inflight auth state",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(error)) => {
            tracing::error!(error=?error, "upstream authorization code grant failed");
            (
                axum::http::StatusCode::BAD_GATEWAY,
                "authorization code exchange failed",
            )
                .into_response()
        }
    }
}

async fn token<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    axum::Form(params): axum::Form<TokenRequest>,
) -> Response {
    match auth_proxy.exchange_token(params).await {
        Ok(response) => Json(response).into_response(),
        Err(TokenExchangeError::UnsupportedGrantType) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported grant_type",
        )
            .into_response(),
        Err(TokenExchangeError::CodeRequired) => {
            (axum::http::StatusCode::BAD_REQUEST, "code required").into_response()
        }
        Err(TokenExchangeError::InvalidOrExpiredCode) => (
            axum::http::StatusCode::BAD_REQUEST,
            "invalid or expired code",
        )
            .into_response(),
        Err(TokenExchangeError::RedirectUriMismatch) => {
            (axum::http::StatusCode::BAD_REQUEST, "redirect_uri mismatch").into_response()
        }
        Err(TokenExchangeError::RedirectUriRequired) => {
            (axum::http::StatusCode::BAD_REQUEST, "redirect_uri required").into_response()
        }
        Err(TokenExchangeError::CodeVerifierRequired) => (
            axum::http::StatusCode::BAD_REQUEST,
            "code_verifier required",
        )
            .into_response(),
        Err(TokenExchangeError::PkceVerificationFailed) => (
            axum::http::StatusCode::BAD_REQUEST,
            "PKCE verification failed",
        )
            .into_response(),
        Err(TokenExchangeError::RefreshTokenRequired) => (
            axum::http::StatusCode::BAD_REQUEST,
            "refresh_token required",
        )
            .into_response(),
        Err(TokenExchangeError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access inflight auth state",
            )
                .into_response()
        }
        Err(TokenExchangeError::RefreshFailed(error)) => {
            tracing::error!(error=?error, "upstream refresh token exchange failed");
            (
                axum::http::StatusCode::BAD_GATEWAY,
                "refresh token exchange failed",
            )
                .into_response()
        }
    }
}

/// Builds the complete MCP router: unauthenticated OAuth broker routes plus
/// the Bearer-protected `/mcp` service route.
pub fn mcp_router<I, S>(
    auth_proxy: McpAuthProxyServiceImpl<I>,
    jwt_args: JwtValidationArgs,
    mcp_service: S,
) -> Router
where
    I: InflightAuthStore + Clone + Send + Sync + 'static,
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    let oauth_routes = Router::new()
        .route("/health", routing::get(health))
        .route(
            "/.well-known/oauth-protected-resource",
            routing::get(protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            routing::get(protected_resource_metadata),
        )
        .route(
            "/mcp/.well-known/oauth-protected-resource",
            routing::get(protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            routing::get(authorization_server_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server/mcp",
            routing::get(authorization_server_metadata),
        )
        .route(
            "/mcp/.well-known/oauth-authorization-server",
            routing::get(authorization_server_metadata),
        )
        .route("/authorize", routing::get(authorize))
        .route("/register", routing::post(register))
        .route("/oauth/callback", routing::get(oauth_callback))
        .route("/token", routing::post(token))
        .with_state(auth_proxy);

    let mcp_route =
        Router::new()
            .nest_service("/mcp", mcp_service)
            .layer(axum_mw::from_fn_with_state(
                jwt_args,
                super::middleware::validate_bearer,
            ));

    oauth_routes.merge(mcp_route).layer(mcp_cors_layer())
}

/// CORS layer for the MCP router.
///
/// Applied outside the bearer middleware so OPTIONS preflights short-circuit
/// to 204 (never hitting auth) and 401 challenges still carry CORS headers —
/// both required for browser clients like claude.ai to complete the OAuth
/// dance over the MCP streamable HTTP transport.
fn mcp_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("mcp-protocol-version"),
            HeaderName::from_static("mcp-session-id"),
        ])
        .expose_headers([
            HeaderName::from_static("mcp-session-id"),
            header::WWW_AUTHENTICATE,
        ])
        .max_age(Duration::from_secs(3600))
}
