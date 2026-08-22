//! Axum router for the MCP OAuth broker.

use std::time::Duration;

use axum::{
    Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderName, Method, StatusCode, header},
    middleware as axum_mw,
    response::{IntoResponse, Json, Response},
    routing,
};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, validate_macro_access_token};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::domain::{
    models::{
        AccessToken, AuthorizationStart, AuthorizeRequest, CompleteLoginResponse, ProductTokens,
        RefreshToken, SessionId, TokenRequest,
    },
    ports::InflightAuthStore,
    service::{
        CompleteLoginError, McpAuthProxyService, McpAuthProxyServiceImpl, StartAuthorizationError,
        TokenExchangeError,
    },
};

/// Shared state for unauthenticated OAuth broker routes.
#[derive(Clone)]
struct OAuthState<I> {
    auth_proxy: McpAuthProxyServiceImpl<I>,
    jwt_args: JwtValidationArgs,
}

/// Health check handler for ALB.
async fn health() -> &'static str {
    "ok"
}

async fn authorization_server_metadata<I: InflightAuthStore + 'static>(
    State(state): State<OAuthState<I>>,
) -> Json<serde_json::Value> {
    Json(state.auth_proxy.authorization_server_metadata())
}

async fn protected_resource_metadata<I: InflightAuthStore + 'static>(
    State(state): State<OAuthState<I>>,
) -> Json<serde_json::Value> {
    Json(state.auth_proxy.protected_resource_metadata())
}

async fn register<I: InflightAuthStore + 'static>(
    State(state): State<OAuthState<I>>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(state.auth_proxy.register_client(body))
}

async fn authorize<I: InflightAuthStore + 'static>(
    State(state): State<OAuthState<I>>,
    Query(params): Query<AuthorizeRequest>,
) -> Response {
    match state.auth_proxy.start_authorization(params).await {
        Ok(AuthorizationStart::ProductLogin { redirect }) => found_redirect(redirect.as_str()),
        Err(StartAuthorizationError::UnsupportedResponseType) => {
            (StatusCode::BAD_REQUEST, "unsupported response_type").into_response()
        }
        Err(StartAuthorizationError::UnsupportedCodeChallengeMethod) => {
            (StatusCode::BAD_REQUEST, "unsupported code_challenge_method").into_response()
        }
        Err(StartAuthorizationError::InvalidRedirectUri) => (
            StatusCode::BAD_REQUEST,
            "redirect_uri must be https or a loopback address",
        )
            .into_response(),
        Err(StartAuthorizationError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to persist inflight auth state");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to persist inflight auth state",
            )
                .into_response()
        }
    }
}

#[derive(serde::Deserialize)]
struct CompleteLoginBody {
    refresh_token: String,
}

async fn complete_login<I: InflightAuthStore + 'static>(
    State(state): State<OAuthState<I>>,
    Path(raw_session_id): Path<String>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<CompleteLoginBody>,
) -> Response {
    let Ok(session_id) = SessionId::parse(&raw_session_id) else {
        return (StatusCode::BAD_REQUEST, "unknown or expired session").into_response();
    };
    let Some(access_token) = bearer_token(&headers) else {
        return (StatusCode::UNAUTHORIZED, "missing bearer token").into_response();
    };
    if validate_macro_access_token(access_token, &state.jwt_args).is_err() {
        return (StatusCode::UNAUTHORIZED, "invalid bearer token").into_response();
    }
    if body.refresh_token.is_empty() {
        return (StatusCode::BAD_REQUEST, "refresh_token required").into_response();
    }

    match state
        .auth_proxy
        .complete_login(
            &session_id,
            ProductTokens {
                access_token: AccessToken::from(access_token),
                refresh_token: RefreshToken::from(body.refresh_token),
            },
        )
        .await
    {
        Ok(CompleteLoginResponse { redirect }) => {
            Json(CompleteLoginResponse { redirect }).into_response()
        }
        Err(CompleteLoginError::UnknownOrExpiredSession) => {
            (StatusCode::BAD_REQUEST, "unknown or expired session").into_response()
        }
        Err(CompleteLoginError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to complete MCP login");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to complete sign-in",
            )
                .into_response()
        }
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| !token.is_empty())
}

fn found_redirect(location: &str) -> Response {
    (StatusCode::FOUND, [(header::LOCATION, location)]).into_response()
}

async fn token<I: InflightAuthStore + 'static>(
    State(state): State<OAuthState<I>>,
    axum::Form(params): axum::Form<TokenRequest>,
) -> Response {
    match state.auth_proxy.exchange_token(params).await {
        Ok(response) => Json(response).into_response(),
        Err(TokenExchangeError::UnsupportedGrantType) => {
            (StatusCode::BAD_REQUEST, "unsupported grant_type").into_response()
        }
        Err(TokenExchangeError::CodeRequired) => {
            (StatusCode::BAD_REQUEST, "code required").into_response()
        }
        Err(TokenExchangeError::InvalidOrExpiredCode) => {
            (StatusCode::BAD_REQUEST, "invalid or expired code").into_response()
        }
        Err(TokenExchangeError::RedirectUriMismatch) => {
            (StatusCode::BAD_REQUEST, "redirect_uri mismatch").into_response()
        }
        Err(TokenExchangeError::RedirectUriRequired) => {
            (StatusCode::BAD_REQUEST, "redirect_uri required").into_response()
        }
        Err(TokenExchangeError::CodeVerifierRequired) => {
            (StatusCode::BAD_REQUEST, "code_verifier required").into_response()
        }
        Err(TokenExchangeError::PkceVerificationFailed) => {
            (StatusCode::BAD_REQUEST, "PKCE verification failed").into_response()
        }
        Err(TokenExchangeError::RefreshTokenRequired) => {
            (StatusCode::BAD_REQUEST, "refresh_token required").into_response()
        }
        Err(TokenExchangeError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access inflight auth state",
            )
                .into_response()
        }
        Err(TokenExchangeError::RefreshFailed(error)) => {
            tracing::error!(error=?error, "upstream refresh token exchange failed");
            (StatusCode::BAD_GATEWAY, "refresh token exchange failed").into_response()
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
        .route(
            "/login/{session_id}/complete",
            routing::post(complete_login),
        )
        .route("/register", routing::post(register))
        .route("/token", routing::post(token))
        .with_state(OAuthState {
            auth_proxy,
            jwt_args: jwt_args.clone(),
        });

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
/// to 204 without hitting auth. The 401 challenges still carry CORS headers,
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
