mod resolver;

use axum::Router;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures::StreamExt;
use macro_middleware::tracking::ClientIp;
use reqwest::StatusCode;
use serde::Deserialize;
use std::error::Error;
use std::fmt;
use std::net::IpAddr;
use std::sync::Arc;
use url::Url;
use utoipa::ToSchema;

use resolver::PrivateIpFilteringResolver;

/// 10 MB max image size
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

/// Maximum number of redirects to follow per proxied fetch. Matches the
/// previous reqwest-managed `Policy::limited(5)` behaviour.
const MAX_REDIRECTS: u8 = 5;

/// Default request timeout for a proxied fetch.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// Default connect timeout for a proxied fetch.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Build the HTTP client used to fetch upstream images.
///
/// SSRF mitigations baked into the client:
///
/// 1. **Redirects disabled** at the reqwest level so the manual loop in
///    [`proxy_request_handler`] can run [`assert_not_internal`] on every hop
///    and follows up to [`MAX_REDIRECTS`] redirects itself.
/// 2. **Private-IP-filtering DNS resolver** ([`PrivateIpFilteringResolver`])
///    enforces the same private-IP check at the moment reqwest actually
///    connects, closing the DNS-rebinding TOCTOU window where the preflight
///    and the connect attempt could see different answers from the
///    authoritative DNS server.
///
/// Owning the client construction here keeps the mitigation inseparable from
/// the handler that relies on it — callers can't accidentally hand in a
/// redirect-following or unfiltered client.
pub(crate) fn build_http_client() -> anyhow::Result<reqwest::Client> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .dns_resolver(Arc::new(PrivateIpFilteringResolver))
        .build()?;
    Ok(client)
}

#[derive(Debug)]
pub enum ProxyError {
    InvalidUrl(String),
    InvalidScheme,
    MissingHost,
    DnsLookupFailed(std::io::Error),
    PrivateIp,
    UpstreamTimeout(String),
    UpstreamConnect(String),
    UpstreamRedirect(String),
    UpstreamNetwork(String),
    UpstreamStatus(reqwest::StatusCode),
    NotAnImage(String),
    ImageTooLarge { content_length: u64 },
    ResponseBuild(axum::http::Error),
}

impl fmt::Display for ProxyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUrl(e) => write!(f, "invalid URL: {e}"),
            Self::InvalidScheme => write!(f, "only http/https URLs are allowed"),
            Self::MissingHost => write!(f, "missing host"),
            Self::DnsLookupFailed(e) => write!(f, "DNS lookup failed: {e}"),
            Self::PrivateIp => write!(f, "requests to private/internal IPs are not allowed"),
            Self::UpstreamTimeout(chain) => {
                write!(f, "timeout fetching upstream image: {chain}")
            }
            Self::UpstreamConnect(chain) => {
                write!(f, "connection error fetching upstream image: {chain}")
            }
            Self::UpstreamRedirect(chain) => {
                write!(f, "too many redirects fetching upstream image: {chain}")
            }
            Self::UpstreamNetwork(chain) => {
                write!(f, "network error fetching upstream image: {chain}")
            }
            Self::UpstreamStatus(status) => write!(f, "upstream returned status {status}"),
            Self::NotAnImage(ct) => write!(f, "upstream content-type is not an image: {ct}"),
            Self::ImageTooLarge { content_length } => write!(
                f,
                "image exceeds max size of {MAX_IMAGE_SIZE} bytes (Content-Length: {content_length})"
            ),
            Self::ResponseBuild(e) => write!(f, "could not build response: {e}"),
        }
    }
}

impl IntoResponse for ProxyError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::InvalidUrl(_)
            | Self::InvalidScheme
            | Self::MissingHost
            | Self::DnsLookupFailed(_) => StatusCode::BAD_REQUEST,
            Self::PrivateIp => StatusCode::FORBIDDEN,
            Self::UpstreamTimeout(_) => StatusCode::GATEWAY_TIMEOUT,
            Self::UpstreamConnect(_)
            | Self::UpstreamRedirect(_)
            | Self::UpstreamNetwork(_)
            | Self::UpstreamStatus(_) => StatusCode::BAD_GATEWAY,
            Self::NotAnImage(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::ImageTooLarge { .. } => StatusCode::UNPROCESSABLE_ENTITY,
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
)]
#[tracing::instrument(err(Debug), skip(http_client))]
pub async fn proxy_request_handler(
    Query(params): Query<ProxyParams>,
    State(http_client): State<reqwest::Client>,
    _ip: ClientIp,
) -> Result<Response, ProxyError> {
    let mut url = validate_url(&params.url)?;
    let mut redirects_remaining = MAX_REDIRECTS;

    let response = loop {
        assert_not_internal(&url).await?;
        let response = send_request(&http_client, &url).await?;
        let status = response.status();

        if status.is_redirection() {
            if redirects_remaining == 0 {
                return Err(ProxyError::UpstreamRedirect(format!(
                    "exceeded maximum of {MAX_REDIRECTS} redirects"
                )));
            }
            let next = redirect_target(&url, &response)?;
            tracing::debug!(from = %url, to = %next, "following redirect");
            redirects_remaining -= 1;
            url = next;
            continue;
        }

        if !status.is_success() {
            return Err(ProxyError::UpstreamStatus(status));
        }

        break response;
    };

    let content_type = extract_content_type(&response)?;

    check_content_length(&response, &params.url)?;

    let size_limited_stream = apply_size_limit(response.bytes_stream(), params.url.clone());

    Response::builder()
        .header("Content-Type", &content_type)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(Body::from_stream(size_limited_stream))
        .map_err(|e| {
            tracing::error!(error=?e, "could not stream chunks");
            ProxyError::ResponseBuild(e)
        })
}

fn validate_url(raw_url: &str) -> Result<Url, ProxyError> {
    let mut url = Url::parse(raw_url).map_err(|e| ProxyError::InvalidUrl(e.to_string()))?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ProxyError::InvalidScheme);
    }

    url.set_fragment(None);
    Ok(url)
}

async fn assert_not_internal(url: &Url) -> Result<(), ProxyError> {
    let host = url.host_str().ok_or(ProxyError::MissingHost)?;

    let port = url.port_or_known_default().unwrap_or(80);
    let addrs = tokio::net::lookup_host(format!("{host}:{port}"))
        .await
        .map_err(ProxyError::DnsLookupFailed)?;

    for addr in addrs {
        if is_private_ip(&addr.ip()) {
            tracing::warn!(host, ip = %addr.ip(), "blocked request to private/internal IP");
            return Err(ProxyError::PrivateIp);
        }
    }

    Ok(())
}

fn is_private_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
        }
        IpAddr::V6(v6) => {
            if let Some(mapped_v4) = v6.to_ipv4_mapped() {
                return is_private_ip(&IpAddr::V4(mapped_v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                // fc00::/7 — Unique Local Addresses (IPv6 equivalent of RFC1918).
                || v6.is_unique_local()
                // fe80::/10 — Link-local; reachable on the local segment only.
                || v6.is_unicast_link_local()
        }
    }
}

/// Issue a GET against `url`. The response is returned without inspecting its
/// status — the caller decides how to handle 3xx (redirect-follow) vs 4xx /
/// 5xx (error). This is intentional: the redirect loop in
/// [`proxy_request_handler`] needs to see 3xx responses so it can run
/// [`assert_not_internal`] against each hop before following.
async fn send_request(
    http_client: &reqwest::Client,
    url: &Url,
) -> Result<reqwest::Response, ProxyError> {
    http_client.get(url.as_str()).send().await.map_err(|e| {
        let error_chain = build_error_chain(&e);
        tracing::warn!(url = %url, error = %error_chain, "upstream request failed");
        if e.is_timeout() {
            ProxyError::UpstreamTimeout(error_chain)
        } else if e.is_connect() {
            ProxyError::UpstreamConnect(error_chain)
        } else if e.is_redirect() {
            ProxyError::UpstreamRedirect(error_chain)
        } else {
            ProxyError::UpstreamNetwork(error_chain)
        }
    })
}

/// Resolve the `Location` header of a 3xx response into the next URL to
/// fetch, applying the same scheme / fragment hygiene as [`validate_url`].
///
/// Does **not** check the target's IPs — the caller must run
/// [`assert_not_internal`] on the returned URL before issuing the next
/// request, so a 302 → internal-IP cannot bypass the preflight.
fn redirect_target(current: &Url, response: &reqwest::Response) -> Result<Url, ProxyError> {
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .ok_or_else(|| {
            ProxyError::UpstreamRedirect("redirect response missing Location header".into())
        })?
        .to_str()
        .map_err(|e| ProxyError::UpstreamRedirect(format!("invalid Location header: {e}")))?;

    let mut next = current.join(location).map_err(|e| {
        ProxyError::UpstreamRedirect(format!("could not parse redirect target {location}: {e}"))
    })?;

    if next.scheme() != "http" && next.scheme() != "https" {
        return Err(ProxyError::InvalidScheme);
    }
    next.set_fragment(None);

    Ok(next)
}

fn extract_content_type(response: &reqwest::Response) -> Result<String, ProxyError> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    if !is_allowed_content_type(&content_type) {
        return Err(ProxyError::NotAnImage(content_type));
    }

    Ok(content_type)
}

fn is_allowed_content_type(content_type: &str) -> bool {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or(content_type)
        .trim()
        .to_ascii_lowercase();

    media_type.starts_with("image/") || media_type == "application/octet-stream"
}

fn check_content_length(
    response: &reqwest::Response,
    original_url: &str,
) -> Result<(), ProxyError> {
    if let Some(content_length) = response.content_length() {
        tracing::info!(
            content_length,
            url = original_url,
            "upstream content length"
        );
        if content_length > MAX_IMAGE_SIZE {
            return Err(ProxyError::ImageTooLarge { content_length });
        }
    }
    Ok(())
}

fn apply_size_limit<S: futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send>(
    stream: S,
    url: String,
) -> impl futures::Stream<Item = Result<bytes::Bytes, axum::Error>> + Send + use<S> {
    let mut bytes_received: u64 = 0;

    stream.map(move |chunk_result: Result<bytes::Bytes, reqwest::Error>| {
        let chunk = chunk_result.map_err(axum::Error::new)?;
        bytes_received += chunk.len() as u64;
        if bytes_received > MAX_IMAGE_SIZE {
            tracing::warn!(
                bytes_received,
                max = MAX_IMAGE_SIZE,
                url = url,
                "image exceeded max size during streaming"
            );
            return Err(axum::Error::new(std::io::Error::other(format!(
                "image exceeded max size of {MAX_IMAGE_SIZE} bytes during streaming"
            ))));
        }
        Ok(chunk)
    })
}

fn build_error_chain(err: &reqwest::Error) -> String {
    let mut chain = format!("{err}");
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push_str(&format!("\nCaused by: {cause}"));
        source = cause.source();
    }
    chain
}

pub fn router() -> Router<crate::api::context::ApiContext> {
    Router::new().route("/", get(proxy_request_handler))
}

#[cfg(test)]
mod test;
