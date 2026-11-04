//! Axum router for the MCP OAuth broker.

#[cfg(test)]
mod test;

use std::time::Duration;

use axum::{
    Router,
    extract::{Query, RawQuery, State},
    http::{HeaderName, HeaderValue, Method, StatusCode, header},
    middleware as axum_mw,
    response::{Html, IntoResponse, Json, Redirect, Response},
    routing,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::domain::{
    models::{
        AuthorizeRequest, CallbackRequest, ClientRegistrationRequest, RevocationRequest,
        TokenRequest,
    },
    ports::UpstreamGrantError,
    service::{
        CompleteCallbackError, InflightAuthStore, McpAuthProxyService, McpAuthProxyServiceImpl,
        RegisterClientError, RevokeTokenError, StartAuthorizationError, TokenExchangeError,
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
    axum::Json(body): axum::Json<ClientRegistrationRequest>,
) -> Response {
    match auth_proxy.register_client(body).await {
        // RFC 7591 section 3.2.1 only says SHOULD for 201, and clients already
        // work against the 200 this endpoint has always returned.
        Ok(registration) => Json(registration).into_response(),
        Err(RegisterClientError::RedirectUrisRequired) => (
            axum::http::StatusCode::BAD_REQUEST,
            "at least one redirect_uri is required",
        )
            .into_response(),
        Err(RegisterClientError::TooManyRedirectUris) => (
            axum::http::StatusCode::BAD_REQUEST,
            "too many redirect_uris",
        )
            .into_response(),
        Err(RegisterClientError::UnsupportedRedirectUri { uri }) => {
            tracing::warn!(
                rejected_redirect_uri = %uri,
                "client registration used a redirect_uri this deployment does not trust"
            );
            (
                axum::http::StatusCode::BAD_REQUEST,
                "redirect_uri must be a loopback address or a trusted MCP client host",
            )
                .into_response()
        }
        Err(RegisterClientError::ClientRegistrationStore(error)) => {
            tracing::error!(error=?error, "failed to persist client registration");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to persist client registration",
            )
                .into_response()
        }
    }
}

/// Hosts whose users pick how to sign in, rather than going straight to
/// Google. OpenAI's reviewers sign in with a password, and can't get through
/// Google's challenges on a shared account.
const SIGN_IN_CHOICE_HOSTS: [&str; 2] = ["chatgpt.com", "chat.openai.com"];

fn offers_sign_in_choice(redirect_uri: &str) -> bool {
    url::Url::parse(redirect_uri).is_ok_and(|uri| {
        uri.scheme() == "https"
            && uri
                .host_str()
                .is_some_and(|host| SIGN_IN_CHOICE_HOSTS.contains(&host))
    })
}

/// The sign-in chooser. Each link repeats the authorize request with the
/// choice added; the query is re-encoded, so nothing from it reaches the page
/// unescaped. Nothing is stored until a link is followed.
fn sign_in_choice(query: Option<String>) -> Response {
    let link = |choice: &str| {
        let query = query.as_deref().unwrap_or_default();
        let mut params = url::form_urlencoded::Serializer::new(String::new());
        params.extend_pairs(url::form_urlencoded::parse(query.as_bytes()));
        params.append_pair("sign_in", choice);
        format!("/authorize?{}", params.finish()).replace('&', "&amp;")
    };
    let page = format!(
        include_str!("sign_in_choice.html"),
        google = link("google"),
        login = link("login"),
    );
    (
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
            (header::X_FRAME_OPTIONS, "DENY"),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
            ),
        ],
        Html(page),
    )
        .into_response()
}

async fn authorize<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    RawQuery(query): RawQuery,
    Query(params): Query<AuthorizeRequest>,
) -> Response {
    if params.sign_in.is_none() && offers_sign_in_choice(&params.redirect_uri) {
        return sign_in_choice(query);
    }
    match auth_proxy.start_authorization(params).await {
        // The browser carries the MCP client page's Referer across this
        // redirect, and FusionAuth rejects any Referer outside its first-party
        // origin list with "Invalid origin uri". The redirect URI policy has
        // already vetted the client, so the client's origin is withheld.
        Ok(url) => (
            [(header::REFERRER_POLICY, "no-referrer")],
            Redirect::temporary(&url),
        )
            .into_response(),
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
            "redirect_uri must be a loopback address or a trusted MCP client host",
        )
            .into_response(),
        Err(StartAuthorizationError::UnregisteredRedirectUri) => (
            axum::http::StatusCode::BAD_REQUEST,
            "redirect_uri was not registered for this client",
        )
            .into_response(),
        Err(StartAuthorizationError::UnknownClient) => (
            axum::http::StatusCode::BAD_REQUEST,
            "Your Macro connection needs to be reconnected. In the app you are connecting from, \
             remove the Macro MCP connection, add it again, and sign in to Macro. \
             Signing in again without removing the connection may reuse the old registration.",
        )
            .into_response(),
        Err(StartAuthorizationError::ClientRegistrationStore(error)) => {
            tracing::error!(error=?error, "failed to read client registrations");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read client registrations",
            )
                .into_response()
        }
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
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(
            error @ UpstreamGrantError::InvalidGrant { .. },
        )) => {
            tracing::warn!(%error, "upstream refused the authorization code");
            (
                StatusCode::BAD_REQUEST,
                "sign-in could not be completed; start the connection again",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(
            error @ UpstreamGrantError::Unavailable { .. },
        )) => {
            tracing::error!(%error, "upstream authorization code grant failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "the sign-in service is temporarily unavailable; try again shortly",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(
            error @ UpstreamGrantError::Failed(_),
        )) => {
            tracing::error!(%error, "upstream authorization code grant failed");
            (
                StatusCode::BAD_GATEWAY,
                "authorization code exchange failed",
            )
                .into_response()
        }
    }
}

/// An RFC 6749 section 5.2 error response.
fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({ "error": error, "error_description": description })),
    )
        .into_response()
}

/// Token endpoint. Errors use the RFC 6749 section 5.2 JSON shape so clients
/// can tell a grant they must discard (`invalid_grant`, 400) from a fault
/// worth retrying (5xx).
async fn token<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    axum::Form(params): axum::Form<TokenRequest>,
) -> Response {
    let (status, error, description) = match auth_proxy.exchange_token(params).await {
        Ok(response) => return Json(response).into_response(),
        Err(TokenExchangeError::UnsupportedGrantType) => (
            StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            "unsupported grant_type",
        ),
        Err(TokenExchangeError::CodeRequired) => {
            (StatusCode::BAD_REQUEST, "invalid_request", "code required")
        }
        Err(TokenExchangeError::RedirectUriRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "redirect_uri required",
        ),
        Err(TokenExchangeError::CodeVerifierRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "code_verifier required",
        ),
        Err(TokenExchangeError::RefreshTokenRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "refresh_token required",
        ),
        Err(TokenExchangeError::ClientIdRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "client_id required",
        ),
        Err(TokenExchangeError::InvalidOrExpiredCode) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "invalid or expired code",
        ),
        Err(TokenExchangeError::RedirectUriMismatch) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "redirect_uri mismatch",
        ),
        Err(TokenExchangeError::PkceVerificationFailed) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "PKCE verification failed",
        ),
        Err(TokenExchangeError::ClientMismatch) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "grant was not issued to this client",
        ),
        Err(TokenExchangeError::UnboundRefreshToken) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh token is not bound to a client",
        ),
        Err(TokenExchangeError::RevokedGrant) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh token has been revoked",
        ),
        Err(TokenExchangeError::RefreshFailed(UpstreamGrantError::InvalidGrant { .. })) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh token is no longer valid; authorize again",
        ),
        Err(TokenExchangeError::RefreshFailed(UpstreamGrantError::Unavailable { retry_after })) => {
            let mut response = oauth_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "temporarily_unavailable",
                "the sign-in service is temporarily unavailable; try again shortly",
            );
            if let Some(retry_after) = retry_after {
                response.headers_mut().insert(
                    header::RETRY_AFTER,
                    HeaderValue::from(retry_after.as_secs()),
                );
            }
            return response;
        }
        Err(TokenExchangeError::RefreshFailed(UpstreamGrantError::Failed(_))) => (
            StatusCode::BAD_GATEWAY,
            "server_error",
            "refresh token exchange failed",
        ),
        Err(TokenExchangeError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to access inflight auth state",
            )
        }
        Err(TokenExchangeError::RefreshTokenBindingStore(error)) => {
            tracing::error!(error=?error, "failed to access refresh token bindings");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to access refresh token bindings",
            )
        }
    };
    oauth_error(status, error, description)
}

/// RFC 7009 revocation endpoint. Errors use the RFC 6749 section 5.2 JSON
/// shape that RFC 7009 section 2.2.1 refers to.
async fn revoke<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    axum::Form(params): axum::Form<RevocationRequest>,
) -> Response {
    let (status, error, description) = match auth_proxy.revoke_token(params).await {
        Ok(()) => return axum::http::StatusCode::OK.into_response(),
        Err(RevokeTokenError::ClientIdRequired) => (
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid_client",
            "client_id required",
        ),
        Err(RevokeTokenError::TokenRequired) => (
            axum::http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "token required",
        ),
        Err(RevokeTokenError::UnsupportedTokenType) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported_token_type",
            "access tokens cannot be revoked; revoke the refresh token instead",
        ),
        Err(RevokeTokenError::ClientMismatch) => (
            axum::http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "token was not issued to this client",
        ),
        Err(RevokeTokenError::RefreshTokenBindingStore(error)) => {
            tracing::error!(error=?error, "failed to access refresh token bindings");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "server_error",
                "failed to access refresh token bindings",
            )
        }
        Err(RevokeTokenError::UpstreamRevocationFailed(error)) => {
            tracing::error!(error=?error, "upstream refresh token revocation failed");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "server_error",
                "upstream refresh token revocation failed",
            )
        }
    };
    oauth_error(status, error, description)
}

/// Builds the unauthenticated OAuth broker routes: discovery metadata,
/// dynamic client registration, authorize, upstream callback, token, and
/// revocation.
pub fn oauth_router<I>(auth_proxy: McpAuthProxyServiceImpl<I>) -> Router
where
    I: InflightAuthStore + 'static,
{
    oauth_routes(auth_proxy).route("/health", routing::get(health))
}

fn oauth_routes<I: InflightAuthStore + 'static>(auth_proxy: McpAuthProxyServiceImpl<I>) -> Router {
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            routing::get(protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
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
        .route("/authorize", routing::get(authorize))
        .route("/register", routing::post(register))
        .route("/oauth/callback", routing::get(oauth_callback))
        .route("/token", routing::post(token))
        .route("/revoke", routing::post(revoke))
        .with_state(auth_proxy)
}

/// Builds the complete MCP router: unauthenticated OAuth broker routes plus
/// the Bearer-protected `/mcp` service route.
pub fn mcp_router<I, S>(
    auth_proxy: McpAuthProxyServiceImpl<I>,
    jwt_args: JwtValidationArgs,
    mcp_service: S,
) -> Router
where
    I: InflightAuthStore + 'static,
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    {
        let clients = auth_proxy.access_token_clients();
        mcp_router_with_oauth(
            oauth_router(auth_proxy),
            super::middleware::BearerAuth { jwt_args, clients },
            mcp_service,
        )
    }
}

/// MCP routes for a shared HTTP listener whose process owns health checks.
pub fn mounted_mcp_router<I, S>(
    auth_proxy: McpAuthProxyServiceImpl<I>,
    jwt_args: JwtValidationArgs,
    mcp_service: S,
) -> Router
where
    I: InflightAuthStore + 'static,
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    {
        let clients = auth_proxy.access_token_clients();
        mcp_router_with_oauth(
            oauth_routes(auth_proxy),
            super::middleware::BearerAuth { jwt_args, clients },
            mcp_service,
        )
    }
}

fn mcp_router_with_oauth<S>(
    oauth: Router,
    auth: super::middleware::BearerAuth,
    mcp_service: S,
) -> Router
where
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    let mcp_route =
        Router::new()
            .nest_service("/mcp", mcp_service)
            .layer(axum_mw::from_fn_with_state(
                auth,
                super::middleware::validate_bearer,
            ));

    mount_at_root_and_prefix(oauth.merge(mcp_route)).layer(mcp_cors_layer())
}

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(super::GATEWAY_PATH_PREFIX, inner)
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
