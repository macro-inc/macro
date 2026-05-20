//! HTTP fetch safety helpers: URL validation, private-IP blocking,
//! upstream-request execution, and content-type / content-length checks.
//!
//! These keep the unfurl service from being abused as a server-side
//! request forgery vector against the internal network.

use std::error::Error;
use std::net::IpAddr;

use reqwest::StatusCode;
use thiserror::Error;
use url::Url;

/// Errors that can occur while fetching a URL for unfurling.
#[derive(Debug, Error)]
pub(super) enum FetchError {
    /// The requested URL could not be parsed.
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    /// The URL used a scheme other than http/https.
    #[error("only http/https URLs are allowed")]
    InvalidScheme,
    /// The URL had no host.
    #[error("missing host")]
    MissingHost,
    /// DNS lookup for the URL's host failed.
    #[error("DNS lookup failed: {0}")]
    DnsLookupFailed(std::io::Error),
    /// The host resolved to a private / internal IP address.
    #[error("requests to private/internal IPs are not allowed")]
    PrivateIp,
    /// Upstream timed out while we were waiting for a response.
    #[error("timeout fetching upstream: {0}")]
    UpstreamTimeout(String),
    /// Upstream connection failed.
    #[error("connection error fetching upstream: {0}")]
    UpstreamConnect(String),
    /// Upstream sent us into too many redirects.
    #[error("too many redirects fetching upstream: {0}")]
    UpstreamRedirect(String),
    /// Generic network error from the upstream request.
    #[error("network error fetching upstream: {0}")]
    UpstreamNetwork(String),
    /// Upstream returned a non-2xx status code.
    #[error("upstream returned status {0}")]
    UpstreamStatus(StatusCode),
    /// Upstream returned an unsupported content-type for unfurling.
    #[error("unexpected content-type: {0}")]
    UnexpectedContentType(String),
    /// Upstream response was larger than the configured size cap.
    #[error("response exceeds max size of {max} bytes (Content-Length: {content_length})")]
    ResponseTooLarge {
        /// The reported `Content-Length` header on the response.
        content_length: u64,
        /// The configured maximum allowed size.
        max: u64,
    },
    /// Error while reading the upstream response body stream.
    #[error("error reading upstream response: {0}")]
    ResponseRead(String),
}

pub(super) fn validate_url(raw_url: &str) -> Result<Url, FetchError> {
    let mut url = Url::parse(raw_url).map_err(|e| FetchError::InvalidUrl(e.to_string()))?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(FetchError::InvalidScheme);
    }

    url.set_fragment(None);
    Ok(url)
}

pub(super) async fn assert_not_internal(url: &Url) -> Result<(), FetchError> {
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

pub(super) fn is_private_ip(ip: &IpAddr) -> bool {
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
/// `reqwest_fetcher::extract_meta_tags` needs to see 3xx responses so it can
/// run [`assert_not_internal`] against each hop before following.
pub(super) async fn send_request(
    http_client: &reqwest::Client,
    url: &Url,
) -> Result<reqwest::Response, FetchError> {
    http_client.get(url.as_str()).send().await.map_err(|e| {
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
    })
}

/// Resolve the `Location` header of a 3xx response into the next URL to
/// fetch, applying the same scheme / fragment hygiene as [`validate_url`].
///
/// Does **not** check the target's IPs — the caller must run
/// [`assert_not_internal`] on the returned URL before issuing the next
/// request, so a 302 → internal-IP cannot bypass the preflight.
pub(super) fn redirect_target(
    current: &Url,
    response: &reqwest::Response,
) -> Result<Url, FetchError> {
    let location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .ok_or_else(|| {
            FetchError::UpstreamRedirect("redirect response missing Location header".into())
        })?
        .to_str()
        .map_err(|e| FetchError::UpstreamRedirect(format!("invalid Location header: {e}")))?;

    let mut next = current.join(location).map_err(|e| {
        FetchError::UpstreamRedirect(format!("could not parse redirect target {location}: {e}"))
    })?;

    if next.scheme() != "http" && next.scheme() != "https" {
        return Err(FetchError::InvalidScheme);
    }
    next.set_fragment(None);

    Ok(next)
}

pub(super) fn content_type_of(response: &reqwest::Response) -> String {
    response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string()
}

pub(super) fn check_content_length(
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

pub(super) fn build_error_chain(err: &reqwest::Error) -> String {
    let mut chain = format!("{err}");
    let mut source = err.source();
    while let Some(cause) = source {
        chain.push_str(&format!("\nCaused by: {cause}"));
        source = cause.source();
    }
    chain
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use super::*;

    #[test]
    fn ipv6_loopback_is_blocked() {
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
    }

    #[test]
    fn ipv6_unspecified_is_blocked() {
        assert!(is_private_ip(&IpAddr::V6(Ipv6Addr::UNSPECIFIED)));
    }

    #[test]
    fn ipv6_unique_local_is_blocked() {
        // fc00::/7 — IPv6 equivalent of RFC1918.
        assert!(is_private_ip(&IpAddr::V6(
            "fc00::1".parse::<Ipv6Addr>().unwrap()
        )));
        assert!(is_private_ip(&IpAddr::V6(
            "fd12:3456:789a::1".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn ipv6_link_local_is_blocked() {
        // fe80::/10 — only reachable on the local link.
        assert!(is_private_ip(&IpAddr::V6(
            "fe80::1".parse::<Ipv6Addr>().unwrap()
        )));
        assert!(is_private_ip(&IpAddr::V6(
            "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
                .parse::<Ipv6Addr>()
                .unwrap()
        )));
    }

    #[test]
    fn ipv6_mapped_v4_loopback_is_blocked() {
        // ::ffff:127.0.0.1 should be treated as 127.0.0.1.
        assert!(is_private_ip(&IpAddr::V6(
            "::ffff:127.0.0.1".parse::<Ipv6Addr>().unwrap()
        )));
        // ::ffff:10.0.0.1 should be treated as RFC1918 10.0.0.0/8.
        assert!(is_private_ip(&IpAddr::V6(
            "::ffff:10.0.0.1".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn ipv6_public_is_allowed() {
        // 2001:4860:4860::8888 — Google public DNS.
        assert!(!is_private_ip(&IpAddr::V6(
            "2001:4860:4860::8888".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn ipv4_public_is_allowed() {
        assert!(!is_private_ip(&IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn ipv4_private_ranges_blocked() {
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::UNSPECIFIED)));
        assert!(is_private_ip(&IpAddr::V4(Ipv4Addr::BROADCAST)));
    }
}
