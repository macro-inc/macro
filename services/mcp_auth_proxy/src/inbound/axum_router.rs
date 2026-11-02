//! Axum router for the MCP OAuth broker.

#[cfg(test)]
mod test;

use std::time::Duration;

use askama::Template;
use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderMap, HeaderName, Method, header},
    middleware as axum_mw,
    response::{IntoResponse, Json, Redirect, Response},
    routing,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use serde::Deserialize;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::domain::{
    browser_binding::BrowserBinding,
    models::{
        AuthorizationStart, AuthorizeRequest, CallbackRequest, ClientRegistrationRequest,
        ConsentPrompt, RevocationRequest, TokenRequest, UserConsent,
    },
    service::{
        CompleteCallbackError, InflightAuthStore, McpAuthProxyService, McpAuthProxyServiceImpl,
        RegisterClientError, RevokeTokenError, StartAuthorizationError, TokenExchangeError,
    },
};

/// Fetch metadata header naming how the request's initiator relates to this
/// origin; browsers set it on every request.
const SEC_FETCH_SITE: HeaderName = HeaderName::from_static("sec-fetch-site");

const INVALID_REDIRECT_URI: &str =
    "redirect_uri must be an https URL or an http URL on a loopback address";

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
            (axum::http::StatusCode::BAD_REQUEST, INVALID_REDIRECT_URI).into_response()
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

/// Cookie carrying the browser's `BrowserBinding`. The `__Host-` prefix makes
/// browsers refuse it unless it is `Secure`, host-only and on `/`, so no
/// sibling domain can plant one.
const BROWSER_BINDING_COOKIE: &str = "__Host-macro_mcp_oauth";

/// The consent screen loads nothing, runs nothing, and cannot be framed, so a
/// page that overlays it cannot trick a click onto Allow.
const CONSENT_PAGE_CSP: &str =
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

const CONSENT_DECLINED_PAGE: &str = include_str!("../../templates/consent_declined.html");

#[derive(Template)]
#[template(path = "consent.html")]
struct ConsentPage<'a> {
    client_name: &'a str,
    redirect_host: &'a str,
    request: &'a AuthorizeRequest,
    consent_token: &'a str,
}

/// What the user chose on the consent screen.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ConsentDecision {
    Approve,
    Deny,
}

/// The consent screen's form: the authorize request it was shown for, the
/// anti-forgery token, and the user's choice.
#[derive(Deserialize)]
struct ConsentSubmission {
    #[serde(flatten)]
    request: AuthorizeRequest,
    consent_token: String,
    decision: ConsentDecision,
}

fn browser_binding(jar: &CookieJar) -> Option<BrowserBinding> {
    jar.get(BROWSER_BINDING_COOKIE)
        .and_then(|cookie| BrowserBinding::parse(cookie.value()))
}

fn browser_binding_cookie(browser: &BrowserBinding) -> Cookie<'static> {
    // `Lax` still reaches the upstream's redirect back to `/oauth/callback`,
    // a top-level navigation, but not a cross-site form post.
    Cookie::build((BROWSER_BINDING_COOKIE, browser.as_str().to_owned()))
        .path("/")
        .secure(true)
        .http_only(true)
        .same_site(SameSite::Lax)
        .build()
}

/// A broker-rendered page with the headers that keep it from being framed,
/// cached, or leaking its URL.
fn html_page(body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CONTENT_SECURITY_POLICY, CONSENT_PAGE_CSP),
            (header::X_FRAME_OPTIONS, "DENY"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        body,
    )
        .into_response()
}

fn consent_page(
    prompt: &ConsentPrompt,
    request: &AuthorizeRequest,
    browser: &BrowserBinding,
) -> Response {
    let page = ConsentPage {
        client_name: &prompt.client_name,
        redirect_host: &prompt.redirect_host,
        request,
        consent_token: &browser.consent_token(),
    };

    match page.render() {
        Ok(body) => html_page(body),
        Err(error) => {
            tracing::error!(error=?error, "failed to render the consent page");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to render the consent page",
            )
                .into_response()
        }
    }
}

/// Answers an authorize request, or an approved consent form, with the
/// upstream sign-in or the consent screen. `redirect` builds the redirect to
/// the sign-in: a `307` for `GET /authorize`, a `303` after the form post.
async fn authorization_response<I: InflightAuthStore + 'static>(
    auth_proxy: &McpAuthProxyServiceImpl<I>,
    request: AuthorizeRequest,
    browser: BrowserBinding,
    consent: UserConsent,
    redirect: fn(&str) -> Redirect,
) -> Response {
    match auth_proxy
        .start_authorization(request.clone(), browser.clone(), consent)
        .await
    {
        // The browser carries the MCP client page's Referer across this
        // redirect, and FusionAuth rejects any Referer outside its first-party
        // origin list with "Invalid origin uri". The redirect URI policy has
        // already vetted the client, so the client's origin is withheld.
        Ok(AuthorizationStart::SignIn(url)) => {
            ([(header::REFERRER_POLICY, "no-referrer")], redirect(&url)).into_response()
        }
        Ok(AuthorizationStart::ConsentRequired(prompt)) => {
            consent_page(&prompt, &request, &browser)
        }
        Err(error) => start_authorization_error_response(error),
    }
}

async fn authorize<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    Query(params): Query<AuthorizeRequest>,
) -> Response {
    let browser = browser_binding(&jar).unwrap_or_else(BrowserBinding::generate);
    let jar = jar.add(browser_binding_cookie(&browser));

    let response = authorization_response(
        &auth_proxy,
        params,
        browser,
        UserConsent::NotAsked,
        Redirect::temporary,
    )
    .await;
    (jar, response).into_response()
}

/// Receives the consent screen's form.
///
/// The form only counts when it was posted by the browser that was shown it:
/// the browser binding cookie must be present (a cross-site post does not
/// carry a `SameSite=Lax` cookie) and the form's token must be the one derived
/// from it, which a page on another origin cannot read.
async fn submit_consent<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    headers: HeaderMap,
    axum::Form(submission): axum::Form<ConsentSubmission>,
) -> Response {
    let cross_site = headers
        .get(SEC_FETCH_SITE)
        .is_some_and(|site| site.as_bytes() != b"same-origin");
    let browser = browser_binding(&jar)
        .filter(|browser| browser.accepts_consent_token(&submission.consent_token));

    let Some(browser) = browser.filter(|_| !cross_site) else {
        tracing::warn!(
            client_id = %submission.request.client_id,
            cross_site,
            "consent form submission could not be verified"
        );
        return (
            axum::http::StatusCode::FORBIDDEN,
            "This approval could not be verified. Start connecting again from the app you \
             are connecting.",
        )
            .into_response();
    };

    match submission.decision {
        ConsentDecision::Deny => {
            tracing::info!(client_id = %submission.request.client_id, "user declined an MCP client");
            html_page(CONSENT_DECLINED_PAGE.to_owned())
        }
        ConsentDecision::Approve => {
            authorization_response(
                &auth_proxy,
                submission.request,
                browser,
                UserConsent::Approved,
                Redirect::to,
            )
            .await
        }
    }
}

fn start_authorization_error_response(error: StartAuthorizationError) -> Response {
    match error {
        StartAuthorizationError::UnsupportedResponseType => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported response_type",
        )
            .into_response(),
        StartAuthorizationError::UnsupportedCodeChallengeMethod => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported code_challenge_method",
        )
            .into_response(),
        StartAuthorizationError::InvalidRedirectUri => {
            (axum::http::StatusCode::BAD_REQUEST, INVALID_REDIRECT_URI).into_response()
        }
        StartAuthorizationError::UnregisteredRedirectUri => (
            axum::http::StatusCode::BAD_REQUEST,
            "redirect_uri was not registered for this client",
        )
            .into_response(),
        StartAuthorizationError::UnknownClient => (
            axum::http::StatusCode::BAD_REQUEST,
            "Your Macro connection needs to be reconnected. In the app you are connecting from, \
             remove the Macro MCP connection, add it again, and sign in to Macro. \
             Signing in again without removing the connection may reuse the old registration.",
        )
            .into_response(),
        StartAuthorizationError::ClientRegistrationStore(error) => {
            tracing::error!(error=?error, "failed to read client registrations");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read client registrations",
            )
                .into_response()
        }
        StartAuthorizationError::InflightStore(error) => {
            tracing::error!(error=?error, "failed to persist inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to persist inflight auth state",
            )
                .into_response()
        }
        StartAuthorizationError::ConstructAuthorizeUrl(error) => {
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
    jar: CookieJar,
    Query(params): Query<CallbackRequest>,
) -> Response {
    match auth_proxy
        .complete_callback(params, browser_binding(&jar))
        .await
    {
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
        Err(CompleteCallbackError::DifferentBrowser) => (
            axum::http::StatusCode::BAD_REQUEST,
            "This sign-in was started in a different browser. Start connecting again from the \
             app you are connecting, and finish signing in in the browser it opens.",
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
        Err(TokenExchangeError::ClientIdRequired) => {
            (axum::http::StatusCode::BAD_REQUEST, "client_id required").into_response()
        }
        Err(TokenExchangeError::ClientMismatch) => (
            axum::http::StatusCode::BAD_REQUEST,
            "grant was not issued to this client",
        )
            .into_response(),
        Err(TokenExchangeError::UnboundRefreshToken) => (
            axum::http::StatusCode::BAD_REQUEST,
            "refresh token is not bound to a client",
        )
            .into_response(),
        Err(TokenExchangeError::RevokedGrant) => (
            axum::http::StatusCode::BAD_REQUEST,
            "refresh token has been revoked",
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
        Err(TokenExchangeError::RefreshTokenBindingStore(error)) => {
            tracing::error!(error=?error, "failed to access refresh token bindings");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access refresh token bindings",
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
    (
        status,
        Json(serde_json::json!({ "error": error, "error_description": description })),
    )
        .into_response()
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
        .route("/authorize", routing::get(authorize).post(submit_consent))
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
