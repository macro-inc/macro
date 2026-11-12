//! HTTP fetch safety helpers: URL validation, private-IP blocking,
//! upstream-request execution, and content-type / content-length checks.
//!
//! These keep the unfurl service from being abused as a server-side
//! request forgery vector against the internal network.

use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

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
        if is_non_public_ip(&addr.ip()) {
            tracing::warn!(host, ip = %addr.ip(), "blocked request to private/internal IP");
            return Err(FetchError::PrivateIp);
        }
    }

    Ok(())
}

pub(super) fn is_non_public_ip(ip: &IpAddr) -> bool {
    match *ip {
        IpAddr::V4(v4) => is_blocked_ipv4(v4),
        IpAddr::V6(v6) => match embedded_ipv4(v6) {
            Some(embedded) => is_blocked_ipv4(embedded),
            None => is_blocked_ipv6(v6),
        },
    }
}

fn is_blocked_ipv4(ip: Ipv4Addr) -> bool {
    let [first, second, third, _] = ip.octets();

    // 0.0.0.0/8: "this network".
    first == 0
        || ip.is_private()
        || ip.is_loopback()
        // 169.254.0.0/16, including the 169.254.169.254 metadata service.
        || ip.is_link_local()
        // 100.64.0.0/10: carrier-grade NAT and Tailscale.
        || (first == 100 && (second & 0xc0) == 64)
        // 192.0.0.0/24: IETF protocol assignments.
        || (first == 192 && second == 0 && third == 0)
        // 198.18.0.0/15: benchmarking.
        || (first == 198 && (second & 0xfe) == 18)
        || ip.is_documentation()
        || ip.is_multicast()
        // 240.0.0.0/4 reserved, and the broadcast address.
        || first >= 240
}

fn is_blocked_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();

    // Only global unicast (2000::/3) is public. Outside it are loopback,
    // multicast, unique-local (including the fd00:ec2::254 metadata
    // service), link-local, local-use NAT64, and the unassigned space.
    (segments[0] & 0xe000) != 0x2000
        // 2001::/32: Teredo, which tunnels to an obfuscated IPv4 address.
        || (segments[0] == 0x2001 && segments[1] == 0)
        // 2001:db8::/32 and 3fff::/20: documentation.
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x3fff && (segments[1] & 0xf000) == 0)
}

/// The IPv4 address an IPv6 address carries: IPv4-mapped (`::ffff:0:0/96`),
/// NAT64 (`64:ff9b::/96`), IPv4-compatible (`::/96`), or 6to4 (`2002::/16`).
fn embedded_ipv4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return Some(mapped);
    }

    let segments = ip.segments();
    let low_bits = Ipv4Addr::from((u32::from(segments[6]) << 16) | u32::from(segments[7]));

    if segments[..6] == [0x64, 0xff9b, 0, 0, 0, 0] || segments[..6] == [0; 6] {
        return Some(low_bits);
    }

    if segments[0] == 0x2002 {
        return Some(Ipv4Addr::from(
            (u32::from(segments[1]) << 16) | u32::from(segments[2]),
        ));
    }

    None
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
        assert!(is_non_public_ip(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
    }

    #[test]
    fn ipv6_unspecified_is_blocked() {
        assert!(is_non_public_ip(&IpAddr::V6(Ipv6Addr::UNSPECIFIED)));
    }

    #[test]
    fn ipv6_unique_local_is_blocked() {
        // fc00::/7 — IPv6 equivalent of RFC1918.
        assert!(is_non_public_ip(&IpAddr::V6(
            "fc00::1".parse::<Ipv6Addr>().unwrap()
        )));
        assert!(is_non_public_ip(&IpAddr::V6(
            "fd12:3456:789a::1".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn ipv6_link_local_is_blocked() {
        // fe80::/10 — only reachable on the local link.
        assert!(is_non_public_ip(&IpAddr::V6(
            "fe80::1".parse::<Ipv6Addr>().unwrap()
        )));
        assert!(is_non_public_ip(&IpAddr::V6(
            "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"
                .parse::<Ipv6Addr>()
                .unwrap()
        )));
    }

    #[test]
    fn ipv6_mapped_v4_loopback_is_blocked() {
        // ::ffff:127.0.0.1 should be treated as 127.0.0.1.
        assert!(is_non_public_ip(&IpAddr::V6(
            "::ffff:127.0.0.1".parse::<Ipv6Addr>().unwrap()
        )));
        // ::ffff:10.0.0.1 should be treated as RFC1918 10.0.0.0/8.
        assert!(is_non_public_ip(&IpAddr::V6(
            "::ffff:10.0.0.1".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn ipv6_public_is_allowed() {
        // 2001:4860:4860::8888 — Google public DNS.
        assert!(!is_non_public_ip(&IpAddr::V6(
            "2001:4860:4860::8888".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn ipv4_public_is_allowed() {
        assert!(!is_non_public_ip(&IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn ipv4_private_ranges_blocked() {
        assert!(is_non_public_ip(&IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_non_public_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
        assert!(is_non_public_ip(&IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        assert!(is_non_public_ip(&IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(is_non_public_ip(&IpAddr::V4(Ipv4Addr::UNSPECIFIED)));
        assert!(is_non_public_ip(&IpAddr::V4(Ipv4Addr::BROADCAST)));
    }

    #[test]
    fn blocks_every_non_public_range() {
        let blocked = [
            // 0.0.0.0/8, not just 0.0.0.0.
            "0.1.2.3",
            // 100.64.0.0/10: carrier-grade NAT and Tailscale.
            "100.64.0.1",
            "100.127.255.254",
            "192.0.0.1",
            "198.18.0.1",
            "198.19.255.255",
            "192.0.2.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
            "ff02::1",
            "fec0::1",
            "2001:db8::1",
            "64:ff9b:1::1",
            "100::1",
            "3fff::1",
            // SIIT IPv4-translated ::ffff:0:127.0.0.1, and unassigned space.
            "::ffff:0:7f00:1",
            "4000::1",
            // fd00:ec2::254: the EC2 metadata service over IPv6.
            "fd00:ec2::254",
            // NAT64 wrapping 127.0.0.1 and 169.254.169.254.
            "64:ff9b::7f00:1",
            "64:ff9b::a9fe:a9fe",
            // IPv4-compatible ::127.0.0.1 and ::10.0.0.1.
            "::7f00:1",
            "::a00:1",
            // 6to4 wrapping 127.0.0.1 and 100.64.0.1.
            "2002:7f00:1::",
            "2002:6440:1::",
            // Teredo.
            "2001::1",
            "2001:0:4136:e378:8000:63bf:3fff:fdd2",
            // IPv4-mapped CGNAT.
            "::ffff:100.64.0.1",
        ];
        for ip in blocked {
            assert!(
                is_non_public_ip(&ip.parse().unwrap()),
                "{ip} should be blocked"
            );
        }
    }

    #[test]
    fn allows_public_addresses_including_wrapped_public_v4() {
        let allowed = [
            "8.8.8.8",
            "100.63.255.255",
            "100.128.0.1",
            "198.20.0.1",
            "2606:4700:4700::1111",
            "64:ff9b::808:808",
            "2002:808:808::",
            "::ffff:1.1.1.1",
        ];
        for ip in allowed {
            assert!(
                !is_non_public_ip(&ip.parse().unwrap()),
                "{ip} should be allowed"
            );
        }
    }

    #[tokio::test]
    async fn assert_not_internal_blocks_wrapped_and_cgnat_literals() {
        for raw in [
            "http://100.64.0.1/",
            "http://0.1.2.3/",
            "http://[64:ff9b::7f00:1]/",
            "http://[::127.0.0.1]/",
            "http://[::ffff:169.254.169.254]/",
            "http://[2002:7f00:1::]/",
            "http://[fd00:ec2::254]/",
        ] {
            let url = Url::parse(raw).unwrap();
            assert!(
                matches!(assert_not_internal(&url).await, Err(FetchError::PrivateIp)),
                "{raw} should be refused"
            );
        }
    }
}
