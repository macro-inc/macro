//! Authenticated streaming transport routing; JWT middleware runs on every hop.
use super::directory::{Directory, Owner, Route, route};
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserIdStr;
use rmcp::transport::streamable_http_server::session::{
    SessionManager, local::LocalSessionManager,
};
use std::sync::Arc;
use std::{convert::Infallible, net::SocketAddr};
use tower::{Service, ServiceExt};

const SESSION: &str = "mcp-session-id";
const FORWARDED: &str = "x-macro-mcp-process";

#[derive(Clone)]
struct Replica<D> {
    directory: D,
    process: String,
    address: SocketAddr,
    public_host: String,
    client: reqwest::Client,
    sessions: Arc<LocalSessionManager>,
}

pub(crate) fn route_sessions<S, D>(
    local: S,
    directory: D,
    process: String,
    address: SocketAddr,
    public_host: String,
    sessions: Arc<LocalSessionManager>,
) -> impl Service<Request<Body>, Response = Response, Error = Infallible, Future: Send>
+ Clone
+ Send
+ Sync
where
    S: Service<Request<Body>, Error = Infallible> + Clone + Send + Sync + 'static,
    S::Response: IntoResponse,
    S::Future: Send,
    D: Directory,
{
    // No redirects, retries, or whole-response timeout: an accepted mutation must
    // never be replayed, and SSE may be waiting for a human for an hour.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("valid replica HTTP client configuration");
    let replica = Replica {
        directory,
        process,
        address,
        public_host,
        client,
        sessions,
    };
    tower::service_fn(move |request: Request<Body>| {
        let local = local.clone();
        let replica = replica.clone();
        async move {
            let result = handle(request, local, replica).await;
            Ok::<_, Infallible>(result.unwrap_or_else(|error| {
                tracing::error!(error=?error, "MCP session routing failed");
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "MCP session routing unavailable; no automatic retry",
                )
                    .into_response()
            }))
        }
    })
}

async fn handle<S, D>(
    request: Request<Body>,
    local: S,
    Replica {
        directory,
        process,
        address,
        public_host,
        client,
        sessions,
    }: Replica<D>,
) -> Result<Response, String>
where
    S: Service<Request<Body>, Error = Infallible>,
    S::Response: IntoResponse,
    D: Directory,
{
    let Some(user) = request.extensions().get::<MacroUserIdStr<'static>>() else {
        return Ok(StatusCode::UNAUTHORIZED.into_response());
    };
    let user = user.to_string();
    let session = request
        .headers()
        .get(SESSION)
        .map(|value| value.to_str().map(str::to_owned))
        .transpose()
        .map_err(|_| "invalid session header")?;
    let forwarded = request
        .headers()
        .get(FORWARDED)
        .map(|value| value.to_str())
        .transpose()
        .map_err(|_| "invalid forwarding header")?;
    let delete = request.method() == axum::http::Method::DELETE;
    if let Some(session) = &session {
        let owner = directory.lookup(session).await?;
        match route(owner.as_ref(), &user, &process, forwarded) {
            Route::Forbidden => return Ok(StatusCode::FORBIDDEN.into_response()),
            Route::Expired => {
                return Ok((
                    StatusCode::NOT_FOUND,
                    "MCP session expired; initialize a new session",
                )
                    .into_response());
            }
            Route::Forward(address) => {
                let owner = owner.expect("forward requires owner");
                let (parts, body) = request.into_parts();
                // Forward protocol headers only; never trust client-supplied routing or Host.
                let mut headers = axum::http::HeaderMap::new();
                for name in [
                    header::AUTHORIZATION.as_str(),
                    header::CONTENT_TYPE.as_str(),
                    header::ACCEPT.as_str(),
                    SESSION,
                    "mcp-protocol-version",
                    "last-event-id",
                ] {
                    if let Some(value) = parts.headers.get(name) {
                        headers.insert(
                            header::HeaderName::from_bytes(name.as_bytes())
                                .map_err(|e| e.to_string())?,
                            value.clone(),
                        );
                    }
                }
                headers.insert(
                    header::HOST,
                    public_host.parse().map_err(|_| "invalid public host")?,
                );
                headers.insert(
                    FORWARDED,
                    owner.process.parse().map_err(|_| "invalid process id")?,
                );
                let upstream = client
                    .request(parts.method, format!("http://{address}/mcp"))
                    .headers(headers)
                    .body(reqwest::Body::wrap_stream(body.into_data_stream()))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let status = upstream.status();
                let headers = upstream.headers().clone();
                let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
                *response.status_mut() = status;
                for name in [
                    header::CONTENT_TYPE.as_str(),
                    header::CACHE_CONTROL.as_str(),
                    SESSION,
                    "mcp-protocol-version",
                    "www-authenticate",
                ] {
                    if let Some(value) = headers.get(name) {
                        response.headers_mut().insert(
                            header::HeaderName::from_bytes(name.as_bytes())
                                .map_err(|e| e.to_string())?,
                            value.clone(),
                        );
                    }
                }
                return Ok(response);
            }
            Route::Local => {
                if !sessions
                    .has_session(&session.clone().into())
                    .await
                    .map_err(|e| e.to_string())?
                {
                    directory.remove(session).await?;
                    return Ok(StatusCode::NOT_FOUND.into_response());
                }
            }
        }
    } else if forwarded.is_some() {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    // rmcp allocates before rejecting a sessionless non-initialize message.
    // Validate that envelope first so rejected calls cannot leak allocations.
    let request = if session.is_none() && request.method() == axum::http::Method::POST {
        let (parts, body) = request.into_parts();
        let bytes = match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            axum::body::to_bytes(body, 1024 * 1024),
        )
        .await
        {
            Ok(Ok(bytes)) => bytes,
            _ => return Ok(StatusCode::BAD_REQUEST.into_response()),
        };
        let valid = matches!(
            serde_json::from_slice::<rmcp::model::ClientJsonRpcMessage>(&bytes),
            Ok(rmcp::model::JsonRpcMessage::Request(
                rmcp::model::JsonRpcRequest {
                    request: rmcp::model::ClientRequest::InitializeRequest(_),
                    ..
                }
            ))
        );
        if !valid {
            return Ok(StatusCode::BAD_REQUEST.into_response());
        }
        Request::from_parts(parts, Body::from(bytes))
    } else {
        request
    };
    let response = local
        .oneshot(request)
        .await
        .unwrap_or_else(|never| match never {})
        .into_response();
    if session.is_none() {
        if let Some(id) = response
            .headers()
            .get(SESSION)
            .and_then(|id| id.to_str().ok())
            && let Err(error) = directory
                .register(
                    id,
                    &Owner {
                        user,
                        process: process.to_owned(),
                        address,
                    },
                )
                .await
        {
            let _ = sessions.close_session(&id.to_owned().into()).await;
            return Err(error);
        }
    } else if delete && response.status().is_success() {
        let id = session.as_deref().expect("session exists");
        directory.remove(id).await?;
    }
    Ok(response)
}
