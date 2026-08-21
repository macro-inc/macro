//! The sandbox-facing HTTP surface.
//!
//! Deliberately thin. It reads the session token off the request, turns a path
//! into an [`EgressTarget`], and converts in both directions; every decision
//! about whether the call may happen belongs to
//! [`crate::domain::service::EgressService`]. Nothing here touches a database
//! or a network.

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use http::header::AUTHORIZATION;
use http::{HeaderMap, StatusCode};
use http_body_util::BodyExt;
use std::sync::Arc;

use crate::domain::error::EgressError;
use crate::domain::model::{
    BoxError, EgressTarget, GitEndpoint, McpServerSlug, ProxyRequest, ProxyResponse, SessionToken,
};
use crate::domain::service::EgressService;

#[cfg(test)]
mod test;

/// What the routes need: the service, and nothing else.
///
/// An `Arc` because axum clones state per request and the service holds
/// connection pools that must not be cloned with it.
pub struct EgressRouterState<Service> {
    service: Arc<Service>,
}

impl<Service> EgressRouterState<Service> {
    /// Wrap the service the routes call.
    pub fn new(service: Arc<Service>) -> Self {
        Self { service }
    }
}

// Derived `Clone` would demand `Service: Clone`, which the service is not.
impl<Service> Clone for EgressRouterState<Service> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

/// The egress routes.
///
/// `/mcp` takes any method because the streamable transport uses three, and
/// which are acceptable is the domain's allowlist to enforce, not this
/// router's. `/git` is narrower only because axum needs a method filter to
/// build a route at all.
pub fn egress_router<Service>(state: EgressRouterState<Service>) -> Router
where
    Service: EgressService + 'static,
{
    Router::new()
        .route("/health", get(health))
        .route("/mcp/{slug}", any(mcp_handler::<Service>))
        .route(
            "/git/{*path}",
            get(git_handler::<Service>).post(git_handler::<Service>),
        )
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn mcp_handler<Service>(
    State(state): State<EgressRouterState<Service>>,
    Path(slug): Path<String>,
    request: Request,
) -> Result<Response, EgressError>
where
    Service: EgressService,
{
    let token = session_token(request.headers())?;
    // A slug that does not parse names no server, and that is the same answer
    // as a slug naming nobody's server: not found, with nothing said about
    // which of the two it was.
    let slug = McpServerSlug::parse(&slug)
        .ok_or_else(|| EgressError::Unroutable(format!("{slug} is not a server name")))?;

    proxy(state, token, EgressTarget::McpServer(slug), request).await
}

/// The whole git route: no repository in the path, because the session has
/// exactly one and the service reads it from the grant. The sandbox's remote
/// is just `<egress>/git`, and git appends these suffixes itself.
///
/// Returns a `Response` rather than a `Result` so an unauthenticated one can
/// carry the challenge git needs - see [`with_basic_challenge`].
async fn git_handler<Service>(
    State(state): State<EgressRouterState<Service>>,
    Path(path): Path<String>,
    request: Request,
) -> Response
where
    Service: EgressService,
{
    match git_proxy(state, path, request).await {
        Ok(response) => response,
        Err(error) => with_basic_challenge(error),
    }
}

async fn git_proxy<Service>(
    state: EgressRouterState<Service>,
    path: String,
    request: Request,
) -> Result<Response, EgressError>
where
    Service: EgressService,
{
    let token = session_token(request.headers())?;

    let endpoint = GitEndpoint::parse(&path, request.uri().query()).ok_or_else(|| {
        EgressError::Unroutable(format!("git endpoint {path} is not served here"))
    })?;

    proxy(state, token, EgressTarget::GitHubGit { endpoint }, request).await
}

/// Advertise Basic on an unauthenticated git response.
///
/// Load-bearing, and only on this route. git does not send a credential
/// up front: it makes the request bare, and only reaches for its credential
/// helper once the server asks. Asking is this header - libcurl picks an auth
/// scheme from it, and with no header there is no scheme to pick, so git holds
/// a perfectly good token it never sends and the clone fails as
/// "Authentication failed" with nothing to point at the cause.
///
/// Not on `/mcp`, where the credential is a bearer token the client already
/// sends up front, and where advertising Basic would only invite an MCP client
/// to prompt somebody for a password that does not exist.
fn with_basic_challenge(error: EgressError) -> Response {
    let unauthenticated = matches!(error, EgressError::Unauthenticated);
    let mut response = error.into_response();
    if unauthenticated {
        response.headers_mut().insert(
            http::header::WWW_AUTHENTICATE,
            http::HeaderValue::from_static(r#"Basic realm="Macro egress", charset="UTF-8""#),
        );
    }
    response
}

async fn proxy<Service>(
    state: EgressRouterState<Service>,
    token: SessionToken,
    target: EgressTarget,
    request: Request,
) -> Result<Response, EgressError>
where
    Service: EgressService,
{
    let response = state
        .service
        .proxy(&token, target, into_proxy_request(request))
        .await?;

    Ok(from_proxy_response(response))
}

/// Read the session token off a request.
///
/// Both presentations are accepted because git cannot manage the first: it
/// only knows how to hand a credential helper's username and password to
/// Basic auth, so the token arrives as the password. The username half is
/// whatever the helper chose and carries no meaning here.
fn session_token(headers: &HeaderMap) -> Result<SessionToken, EgressError> {
    let value = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or(EgressError::Unauthenticated)?;

    if let Some(token) = value.strip_prefix("Bearer ") {
        return Ok(SessionToken::new(token));
    }

    let encoded = value
        .strip_prefix("Basic ")
        .ok_or(EgressError::Unauthenticated)?;
    let decoded = BASE64
        .decode(encoded.trim())
        .map_err(|_| EgressError::Unauthenticated)?;
    let decoded = String::from_utf8(decoded).map_err(|_| EgressError::Unauthenticated)?;
    let (_username, password) = decoded
        .split_once(':')
        .ok_or(EgressError::Unauthenticated)?;

    Ok(SessionToken::new(password))
}

/// axum's body is already an `http_body::Body`, so this is an error-type
/// change and a box, not a copy. Collecting instead would break both things
/// this proxy carries: event streams that stay open for a tool call, and
/// packfiles the size of a repository.
fn into_proxy_request(request: Request) -> ProxyRequest {
    let (parts, body) = request.into_parts();
    ProxyRequest::from_parts(
        parts,
        body.map_err(|error| Box::new(error) as BoxError)
            .boxed_unsync(),
    )
}

fn from_proxy_response(response: ProxyResponse) -> Response {
    let (parts, body) = response.into_parts();
    Response::from_parts(parts, Body::new(body))
}

impl IntoResponse for EgressError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Unauthenticated | Self::SessionClosed => StatusCode::UNAUTHORIZED,
            Self::UnknownServer(_) | Self::Unroutable(_) => StatusCode::NOT_FOUND,
            Self::RepoUnavailable(_) => StatusCode::FORBIDDEN,
            Self::MethodNotAllowed(_) => StatusCode::METHOD_NOT_ALLOWED,
            // 424 Failed Dependency: the request was fine, something it
            // depends on is not, and no retry will change that.
            Self::NeedsReauthorization(_) => StatusCode::FAILED_DEPENDENCY,
            // The named upstream is unusable as configured. Someone has to
            // fix the URL; the agent cannot.
            Self::InsecureUpstream(_) => StatusCode::BAD_GATEWAY,
            Self::Upstream(_) => StatusCode::BAD_GATEWAY,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        // Fixed text, never the error's own `Display`. An `EgressError`
        // carries a `rootcause::Report`, a reqwest failure, or an upstream URL,
        // and any of those can quote the request that produced it - which is a
        // request we had just stamped the owner's credential onto. Detail goes
        // to `tracing`, where the person debugging can see it and the model
        // cannot.
        //
        // The exception is the one refusal an agent can act on. An agent given
        // an opaque error retries, and retrying a dead OAuth grant burns a turn
        // to no end, so that case says what has to happen instead - naming only
        // the slug the sandbox already dialled.
        let body = match &self {
            Self::NeedsReauthorization(slug) => format!(
                "The MCP server \"{slug}\" is no longer authorized. Do not retry: ask the person \
                 you are working for to reconnect \"{slug}\" in Macro's settings, then try again.",
            ),
            Self::Unauthenticated => "Not authenticated.".to_owned(),
            Self::SessionClosed => "This session is no longer open.".to_owned(),
            Self::Unroutable(_) => "Nothing is served at that path.".to_owned(),
            Self::UnknownServer(_) => "No such connected MCP server.".to_owned(),
            Self::RepoUnavailable(_) => {
                "This session's repository is not reachable with Macro's GitHub App.".to_owned()
            }
            Self::MethodNotAllowed(_) => "That method is not allowed here.".to_owned(),
            Self::InsecureUpstream(_) => {
                "That upstream is misconfigured and cannot be reached.".to_owned()
            }
            Self::Upstream(_) => "The upstream could not be reached.".to_owned(),
            Self::Internal(_) => "Egress failed.".to_owned(),
        };

        (status, body).into_response()
    }
}
