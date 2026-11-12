use crate::api::context::AuthorizationService;

use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures::StreamExt;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_middleware::tracking::ClientIp;
use model::response::ErrorResponse;
use reqwest::StatusCode;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};
use safe_fetch::{
    AcceptedMediaTypes, AddressPolicy, AllowedPorts, AllowedSchemes, FetchError, FetchPolicy,
    MediaType, SafeFetcher, SafeResponse,
};
use serde::Deserialize;
use std::fmt;
use std::time::Duration;
use tracing::Level;
use utoipa::ToSchema;

/// 10 MB max image size
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

/// User-Agent for the primary upstream fetch. `reqwest` sends none by default,
/// and some origins (strict WAFs, bare nginx) 403 requests with no User-Agent;
/// a browser-like string clears those rules. Shaped like Gmail's image proxy —
/// a real browser string plus a proxy identifier. A minority of hosts do the
/// reverse, so [`proxy_request_handler`] retries once with no UA on failure.
const UPSTREAM_USER_AGENT: &str = "Mozilla/5.0 (compatible; MacroImageProxy/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// Build the fetcher used for upstream images. `safe_fetch` owns the SSRF
/// defences (address checks on the connected address, per-hop redirect
/// checks, deadlines, streaming size cap); this only states the limits.
///
/// Any port stays allowed, as before. `application/octet-stream` (and no
/// Content-Type at all) stays accepted because many image hosts send it; SVG
/// no longer is, since an SVG opened from this origin runs its script here.
pub(crate) fn build_fetcher() -> Result<SafeFetcher, safe_fetch::BuildError> {
    SafeFetcher::new(FetchPolicy {
        schemes: AllowedSchemes::HttpAndHttps,
        ports: AllowedPorts::Any,
        addresses: AddressPolicy::public_only(),
        max_redirects: 5,
        connect_timeout: Duration::from_secs(5),
        total_timeout: Duration::from_secs(15),
        body_idle_timeout: Duration::from_secs(10),
        max_body_bytes: MAX_IMAGE_SIZE,
        media_types: AcceptedMediaTypes::images_except_svg().and(MediaType::octet_stream()),
    })
}

#[derive(Debug)]
pub enum ProxyError {
    Fetch(FetchError),
    ResponseBuild(axum::http::Error),
}

impl ProxyError {
    /// Whether this failure might be the upstream rejecting our User-Agent —
    /// a non-2xx status or a non-image challenge page. Worth one retry with no
    /// UA. Network/timeout/redirect errors aren't UA-related, so we don't retry
    /// those (it would just double latency on genuinely-broken hosts).
    fn is_retryable_without_ua(&self) -> bool {
        matches!(
            self,
            Self::Fetch(FetchError::Status { .. } | FetchError::MediaTypeNotAllowed { .. })
        )
    }
}

impl fmt::Display for ProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fetch(FetchError::AddressNotAllowed { .. }) => {
                write!(f, "requests to private/internal IPs are not allowed")
            }
            Self::Fetch(error) => write!(f, "{error}"),
            Self::ResponseBuild(e) => write!(f, "could not build response: {e}"),
        }
    }
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Fetch(FetchError::AddressNotAllowed { .. }) => StatusCode::FORBIDDEN,
            Self::Fetch(error) if error.is_refused_by_policy() => StatusCode::BAD_REQUEST,
            Self::Fetch(FetchError::Resolution) => StatusCode::BAD_REQUEST,
            Self::Fetch(FetchError::TotalTimeout | FetchError::BodyStalled) => {
                StatusCode::GATEWAY_TIMEOUT
            }
            // Hosts refuse hotlinking or have dropped the image; neither is
            // a gateway failure.
            Self::Fetch(FetchError::Status { status }) if status.is_client_error() => {
                StatusCode::NOT_FOUND
            }
            Self::Fetch(FetchError::MediaTypeNotAllowed { .. }) => {
                StatusCode::UNSUPPORTED_MEDIA_TYPE
            }
            Self::Fetch(FetchError::BodyTooLarge { .. }) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Fetch(_) => StatusCode::BAD_GATEWAY,
            Self::ResponseBuild(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

#[derive(Debug, ToSchema, Deserialize)]
pub struct ProxyParams {
    pub url: String,
}

#[utoipa::path(
    get,
    path = "/proxy",
    params(("url" = String, Query, description = "The image url to proxy")),
    responses(
        (status = 401, description = "Unauthorized", body = ErrorResponse),
    ),
)]
// WARN: every refusal here is the URL's or its host's doing. A response that
// fails to build is ours, and logs at ERROR where it happens.
#[tracing::instrument(
    err(level = Level::WARN, Debug),
    skip_all,
    fields(actor = %user.acting_entity())
)]
pub async fn proxy_request_handler(
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Query(params): Query<ProxyParams>,
    State(fetcher): State<SafeFetcher>,
    _ip: ClientIp,
) -> Result<Response, ProxyError> {
    let mut browser_headers = HeaderMap::new();
    browser_headers.insert(USER_AGENT, HeaderValue::from_static(UPSTREAM_USER_AGENT));

    // Primary attempt with a browser-like User-Agent — most hosts are fine
    // either way, but strict origins 403 a missing UA.
    let response = match fetch(&fetcher, &params.url, browser_headers).await {
        Ok(response) => response,
        // A minority of hosts reject our browser UA or serve a non-image
        // challenge page. Retry once with no UA to cover them.
        Err(err) if err.is_retryable_without_ua() => {
            tracing::info!(error = %err, "retrying upstream fetch without User-Agent");
            fetch(&fetcher, &params.url, HeaderMap::new()).await?
        }
        Err(err) => return Err(err),
    };

    let body = response
        .body
        .into_stream()
        .map(|chunk| chunk.map_err(axum::Error::new));

    Response::builder()
        .header("Content-Type", response.media_type.as_str())
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(body))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            ProxyError::ResponseBuild(e)
        })
}

async fn fetch(
    fetcher: &SafeFetcher,
    url: &str,
    headers: HeaderMap,
) -> Result<SafeResponse, ProxyError> {
    fetcher.get(url, headers).await.map_err(ProxyError::Fetch)
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}

#[cfg(test)]
mod test;
