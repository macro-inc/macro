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
use axum_extra::headers::authorization::{Basic, Bearer};
use axum_extra::headers::{Authorization, HeaderMapExt};
use http::{HeaderMap, StatusCode};
use http_body_util::BodyExt;
use std::sync::Arc;

use crate::domain::error::EgressError;
use crate::domain::model::{
    BoxError, EgressTarget, GitEndpoint, McpDestination, McpServerSlug, ProxyRequest,
    ProxyResponse, SessionToken,
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
        .route("/mcp-macro", any(macro_mcp_handler::<Service>))
        .route(
            "/git/{*path}",
            get(git_handler::<Service>).post(git_handler::<Service>),
        )
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

// `skip_all` on every handler is load-bearing: the request's headers carry the
// sandbox's session token, and an instrument attribute that Debug-formatted
// `request` would put it in the trace.
#[tracing::instrument(skip_all, err, fields(%slug))]
async fn mcp_handler<Service>(
    State(state): State<EgressRouterState<Service>>,
    Path(slug): Path<String>,
    request: Request,
) -> Result<Response, EgressError>
where
    Service: EgressService,
{
    // A slug that does not parse names no server, and that is the same answer
    // as a slug naming nobody's server: not found, with nothing said about
    // which of the two it was.
    let slug = McpServerSlug::parse(&slug)
        .ok_or_else(|| EgressError::Unroutable(format!("{slug} is not a server name")))?;

    mcp_proxy(state, McpDestination::Connected(slug), request).await
}

/// Macro's own MCP server, on its own route rather than under `/mcp/{slug}`:
/// with no name shared between the built-in server and the owner's connected
/// apps, no connected app can collide with it.
#[tracing::instrument(skip_all, err)]
async fn macro_mcp_handler<Service>(
    State(state): State<EgressRouterState<Service>>,
    request: Request,
) -> Result<Response, EgressError>
where
    Service: EgressService,
{
    mcp_proxy(state, McpDestination::Macro, request).await
}

/// One MCP request through the proxy, whichever destination its route named.
async fn mcp_proxy<Service>(
    state: EgressRouterState<Service>,
    destination: McpDestination,
    request: Request,
) -> Result<Response, EgressError>
where
    Service: EgressService,
{
    let token = session_token(request.headers())?;
    dispatch(state, token, EgressTarget::McpServer(destination), request).await
}

/// The whole git route: no repository in the path, because the session has
/// exactly one and the service reads it from the grant. The sandbox's remote
/// is just `<egress>/git`, and git appends these suffixes itself.
async fn git_handler<Service>(
    State(state): State<EgressRouterState<Service>>,
    Path(path): Path<String>,
    request: Request,
) -> Result<Response, GitRefusal>
where
    Service: EgressService,
{
    git_proxy(state, path, request).await.map_err(GitRefusal)
}

/// One git smart-HTTP request through the proxy.
#[tracing::instrument(skip_all, err, fields(%path))]
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

    dispatch(state, token, EgressTarget::GitHubGit { endpoint }, request).await
}

/// A refusal on the git route, which renders like any other except that an
/// unauthenticated one advertises Basic.
///
/// The advertisement is load-bearing, and only on this route. git does not
/// send a credential up front: it makes the request bare, and only reaches for
/// its credential helper once the server asks. Asking is this header - libcurl
/// picks an auth scheme from it, and with no header there is no scheme to
/// pick, so git holds a perfectly good token it never sends and the clone
/// fails as "Authentication failed" with nothing to point at the cause.
///
/// Not on `/mcp`, where the credential is a bearer token the client already
/// sends up front, and where advertising Basic would only invite an MCP client
/// to prompt somebody for a password that does not exist.
struct GitRefusal(EgressError);

impl IntoResponse for GitRefusal {
    fn into_response(self) -> Response {
        let unauthenticated = matches!(self.0, EgressError::Unauthenticated(_));
        let mut response = self.0.into_response();
        if unauthenticated {
            response.headers_mut().insert(
                http::header::WWW_AUTHENTICATE,
                http::HeaderValue::from_static(r#"Basic realm="Macro egress", charset="UTF-8""#),
            );
        }
        response
    }
}

/// The shared tail of both proxies: hand the request to the domain service,
/// converting the body types in both directions.
async fn dispatch<Service>(
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
/// Both schemes are accepted because git cannot manage the first: it only
/// knows how to hand a credential helper's username and password to Basic
/// auth, so the token arrives as the password. The username half is whatever
/// the helper chose and carries no meaning here.
fn session_token(headers: &HeaderMap) -> Result<SessionToken, EgressError> {
    if let Some(Authorization(bearer)) = headers.typed_get::<Authorization<Bearer>>() {
        return Ok(SessionToken::new(bearer.token()));
    }

    headers
        .typed_get::<Authorization<Basic>>()
        .map(|Authorization(basic)| SessionToken::new(basic.password()))
        .ok_or(EgressError::Unauthenticated("no session token presented"))
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
            Self::Unauthenticated(_) | Self::SessionClosed => StatusCode::UNAUTHORIZED,
            Self::UnknownServer(_) | Self::Unroutable(_) => StatusCode::NOT_FOUND,
            Self::RepoUnavailable(_) => StatusCode::FORBIDDEN,
            Self::MethodNotAllowed(_) => StatusCode::METHOD_NOT_ALLOWED,
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
        let body = match &self {
            Self::Unauthenticated(reason) => {
                return (status, format!("Not authorized: {reason}.")).into_response();
            }
            Self::SessionClosed => "This session is no longer open.",
            Self::Unroutable(_) => "Nothing is served at that path.",
            Self::UnknownServer(_) => "No such connected MCP server.",
            Self::RepoUnavailable(_) => {
                "This session's repository is not reachable with Macro's GitHub App."
            }
            Self::MethodNotAllowed(_) => "That method is not allowed here.",
            Self::InsecureUpstream(_) => "That upstream is misconfigured and cannot be reached.",
            Self::Upstream(_) => "The upstream could not be reached.",
            Self::Internal(_) => "Egress failed.",
        };

        (status, body).into_response()
    }
}
