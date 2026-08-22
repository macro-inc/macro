//! Axum router for the MCP OAuth broker.

use std::time::Duration;

use axum::{
    Router,
    extract::{Path, Query, State},
    http::{HeaderName, Method, StatusCode, header},
    middleware as axum_mw,
    response::{Html, IntoResponse, Json, Redirect, Response},
    routing,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::domain::{
    models::{
        AuthorizationStart, AuthorizeRequest, CallbackRequest, Email, LoginAction, LoginAdvance,
        LoginPageError, LoginSurface, OneTimeCode, ResumeUri, SessionId, TokenRequest,
    },
    ports::InflightAuthStore,
    service::{
        AdvanceLoginError, CompleteCallbackError, LoginSurfaceError, McpAuthProxyService,
        McpAuthProxyServiceImpl, StartAuthorizationError, TokenExchangeError,
    },
};

use super::login_page::render_login_page;

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
        Ok(AuthorizationStart::Login { session_id }) => {
            found_redirect(&format!("/login/{session_id}"))
        }
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
struct LoginForm {
    action: String,
    email: Option<String>,
    code: Option<String>,
}

async fn login<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    Path(raw_session_id): Path<String>,
) -> Response {
    let Ok(session_id) = SessionId::parse(&raw_session_id) else {
        return login_page_response(&LoginSurface::Expired);
    };
    match auth_proxy.login_surface(&session_id).await {
        Ok(surface) => login_page_response(&surface),
        Err(LoginSurfaceError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to load broker login session");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to load sign-in session",
            )
                .into_response()
        }
    }
}

async fn login_post<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    Path(raw_session_id): Path<String>,
    axum::Form(form): axum::Form<LoginForm>,
) -> Response {
    let Ok(session_id) = SessionId::parse(&raw_session_id) else {
        return login_page_response(&LoginSurface::Expired);
    };
    let action = match parse_login_action(form, &session_id, auth_proxy.public_url()) {
        Ok(action) => action,
        Err(error) => {
            return login_surface_with_error(&auth_proxy, &session_id, error).await;
        }
    };

    match auth_proxy.advance_login(&session_id, action).await {
        Ok(LoginAdvance::Show(surface)) => login_page_response(&surface),
        Ok(LoginAdvance::Redirect(destination)) => {
            Redirect::to(destination.as_str()).into_response()
        }
        Err(AdvanceLoginError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to update broker login session");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to update sign-in session",
            )
                .into_response()
        }
        Err(AdvanceLoginError::ConstructAuthorizeUrl(error)) => {
            tracing::error!(error=?error, "failed to construct upstream authorize URL");
            (
                StatusCode::BAD_GATEWAY,
                "failed to continue with the identity provider",
            )
                .into_response()
        }
        Err(AdvanceLoginError::Issue(error)) => {
            tracing::error!(error=?error, "failed to issue broker authorization code");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to complete sign-in",
            )
                .into_response()
        }
    }
}

fn parse_login_action(
    form: LoginForm,
    session_id: &SessionId,
    public_url: &str,
) -> Result<LoginAction, LoginPageError> {
    match form.action.as_str() {
        "google" => Ok(LoginAction::ChooseGoogle),
        "email" => {
            let email = form
                .email
                .as_deref()
                .ok_or(LoginPageError::InvalidEmail)
                .and_then(|email| Email::parse(email).map_err(|_| LoginPageError::InvalidEmail))?;
            Ok(LoginAction::SubmitEmail {
                email,
                resume_uri: ResumeUri::broker_login(public_url, session_id),
            })
        }
        "otp" => {
            let code = form
                .code
                .as_deref()
                .ok_or(LoginPageError::InvalidOtp)
                .and_then(|code| {
                    OneTimeCode::parse(code).map_err(|_| LoginPageError::InvalidOtp)
                })?;
            Ok(LoginAction::SubmitOtp(code))
        }
        "back" => Ok(LoginAction::Back),
        _ => Err(LoginPageError::WrongPhase),
    }
}

async fn login_surface_with_error<I: InflightAuthStore + 'static>(
    auth_proxy: &McpAuthProxyServiceImpl<I>,
    session_id: &SessionId,
    error: LoginPageError,
) -> Response {
    match auth_proxy.login_surface(session_id).await {
        Ok(surface) => {
            let surface = match surface {
                LoginSurface::ChooseMethod { session_id }
                | LoginSurface::EnterEmail { session_id, .. } => LoginSurface::EnterEmail {
                    session_id,
                    error: Some(error),
                },
                LoginSurface::EnterOtp {
                    session_id, email, ..
                } => LoginSurface::EnterOtp {
                    session_id,
                    email,
                    local_otp: None,
                    error: Some(error),
                },
                LoginSurface::Expired => LoginSurface::Expired,
            };
            login_page_response(&surface)
        }
        Err(LoginSurfaceError::InflightStore(store_error)) => {
            tracing::error!(error=?store_error, "failed to load broker login session");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to load sign-in session",
            )
                .into_response()
        }
    }
}

fn login_page_response(surface: &LoginSurface) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Html(render_login_page(surface)),
    )
        .into_response()
}

fn found_redirect(location: &str) -> Response {
    (StatusCode::FOUND, [(header::LOCATION, location)]).into_response()
}

async fn oauth_callback<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    Query(params): Query<CallbackRequest>,
) -> Response {
    match auth_proxy.complete_callback(params).await {
        Ok(url) => found_redirect(&url),
        Err(CompleteCallbackError::MissingState) => {
            tracing::warn!("no state parameter in upstream OAuth callback");
            (StatusCode::BAD_REQUEST, "missing state parameter").into_response()
        }
        Err(CompleteCallbackError::MissingCode) => {
            tracing::warn!("upstream OAuth callback missing both code and error");
            (StatusCode::BAD_REQUEST, "missing code parameter").into_response()
        }
        Err(CompleteCallbackError::UnknownOrExpiredSession) => {
            (StatusCode::BAD_REQUEST, "unknown or expired session").into_response()
        }
        Err(CompleteCallbackError::WrongPhase) => (
            StatusCode::BAD_REQUEST,
            "session is not awaiting an upstream callback",
        )
            .into_response(),
        Err(CompleteCallbackError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access inflight auth state",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(error)) => {
            tracing::error!(error=?error, "upstream authorization code grant failed");
            (
                StatusCode::BAD_GATEWAY,
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
        .route("/login/{session_id}", routing::get(login).post(login_post))
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
