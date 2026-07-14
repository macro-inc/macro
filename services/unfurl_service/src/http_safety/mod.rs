use axum::response::{IntoResponse, Response};
use futures::StreamExt;
use reqwest::StatusCode;
use std::error::Error;
use std::fmt;
use std::net::IpAddr;
use url::Url;

#[derive(Debug)]
pub enum FetchError {
    InvalidUrl(String),
    InvalidScheme,
    MissingHost,
    DnsLookupFailed(std::io::Error),
    PrivateIp,
    UpstreamTimeout(String),
    UpstreamConnect(String),
    UpstreamRedirect(String),
    UpstreamNetwork(String),
    UpstreamStatus(StatusCode),
    UnexpectedContentType(String),
    ResponseTooLarge { content_length: u64, max: u64 },
    ResponseRead(String),
    ResponseBuild(axum::http::Error),
}

impl fmt::Display for FetchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUrl(e) => write!(f, "invalid URL: {e}"),
            Self::InvalidScheme => write!(f, "only http/https URLs are allowed"),
            Self::MissingHost => write!(f, "missing host"),
            Self::DnsLookupFailed(e) => write!(f, "DNS lookup failed: {e}"),
            Self::PrivateIp => write!(f, "requests to private/internal IPs are not allowed"),
            Self::UpstreamTimeout(chain) => write!(f, "timeout fetching upstream: {chain}"),
            Self::UpstreamConnect(chain) => {
                write!(f, "connection error fetching upstream: {chain}")
            }
            Self::UpstreamRedirect(chain) => {
                write!(f, "too many redirects fetching upstream: {chain}")
            }
            Self::UpstreamNetwork(chain) => write!(f, "network error fetching upstream: {chain}"),
            Self::UpstreamStatus(status) => write!(f, "upstream returned status {status}"),
            Self::UnexpectedContentType(ct) => write!(f, "unexpected content-type: {ct}"),
            Self::ResponseTooLarge {
                content_length,
                max,
            } => write!(
                f,
                "response exceeds max size of {max} bytes (Content-Length: {content_length})"
            ),
            Self::ResponseRead(chain) => write!(f, "error reading upstream response: {chain}"),
            Self::ResponseBuild(e) => write!(f, "could not build response: {e}"),
        }
    }
}

impl IntoResponse for FetchError {
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
            | Self::UpstreamStatus(_)
            | Self::ResponseRead(_) => StatusCode::BAD_GATEWAY,
            Self::UnexpectedContentType(_) => StatusCode::UNSUPPORTED_MEDIA_TYPE,
            Self::ResponseTooLarge { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            Self::ResponseBuild(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

pub fn validate_url(raw_url: &str) -> Result<Url, FetchError> {
    let mut url = Url::parse(raw_url).map_err(|e| FetchError::InvalidUrl(e.to_string()))?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(FetchError::InvalidScheme);
    }

    url.set_fragment(None);
    Ok(url)
}

pub async fn assert_not_internal(url: &Url) -> Result<(), FetchError> {
    let host = url.host_str().ok_or(FetchError::MissingHost)?;

    let port = url.port_or_known_default().unwrap_or(80);
    let addrs = tokio::net::lookup_host(format!("{host}:{port}"))
        .await
        .map_err(FetchError::DnsLookupFailed)?;

    for addr in addrs {
        if is_private_ip(&addr.ip()) {
            tracing::warn!(host, ip = %addr.ip(), "blocked request to private/internal IP");
            return Err(FetchError::PrivateIp);
        }
    }

    Ok(())
}

pub fn is_private_ip(ip: &IpAddr) -> bool {
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
            v6.is_loopback() || v6.is_unspecified()
        }
    }
}

pub async fn send_request(
    http_client: &reqwest::Client,
    url: &Url,
) -> Result<reqwest::Response, FetchError> {
    let response = http_client.get(url.as_str()).send().await.map_err(|e| {
        let error_chain = build_error_chain(&e);
        tracing::warn!(url = %url, error = %error_chain, "upstream request failed");
        if e.is_timeout() {
            FetchError::UpstreamTimeout(error_chain)
        } else if e.is_connect() {
            FetchError::UpstreamConnect(error_chain)
        } else if e.is_redirect() {
            FetchError::UpstreamRedirect(error_chain)
        } else {
            FetchError::UpstreamNetwork(error_chain)
        }
    })?;

    if !response.status().is_success() {
        return Err(FetchError::UpstreamStatus(response.status()));
    }

    Ok(response)
}

pub fn content_type_of(response: &reqwest::Response) -> String {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string()
}

pub fn check_content_length(
    response: &reqwest::Response,
    max: u64,
    original_url: &str,
) -> Result<(), FetchError> {
    if let Some(content_length) = response.content_length() {
        tracing::info!(
            content_length,
            url = original_url,
            "upstream content length"
        );
        if content_length > max {
            return Err(FetchError::ResponseTooLarge {
                content_length,
                max,
            });
        }
    }
    Ok(())
}

pub fn apply_size_limit<S: futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send>(
    stream: S,
    max: u64,
    url: String,
) -> impl futures::Stream<Item = Result<bytes::Bytes, axum::Error>> + Send + use<S> {
    let mut bytes_received: u64 = 0;

    stream.map(move |chunk_result: Result<bytes::Bytes, reqwest::Error>| {
        let chunk = chunk_result.map_err(axum::Error::new)?;
        bytes_received += chunk.len() as u64;
        if bytes_received > max {
            tracing::warn!(
                bytes_received,
                max,
                url = url,
                "response exceeded max size during streaming"
            );
            return Err(axum::Error::new(std::io::Error::other(format!(
                "response exceeded max size of {max} bytes during streaming"
            ))));
        }
        Ok(chunk)
    })
}

pub fn build_error_chain(err: &reqwest::Error) -> String {
    let mut chain = format!("{err}");
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push_str(&format!("\nCaused by: {cause}"));
        source = cause.source();
    }
    chain
}

#[cfg(test)]
mod test;
