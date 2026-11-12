//! The HTTP client that reads email images from the public internet.
//!
//! An inbound email chooses every `<img src>` this service fetches, so the
//! client connects only to public addresses. The check runs in the DNS
//! resolver reqwest connects with, so an answer can't change between check
//! and use. IP-literal hosts never reach a resolver, so [`is_fetchable`]
//! checks them before the first request and before every redirect hop.

use std::future::Future;
use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::redirect;
use url::{Host, Url};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 5;

static PUBLIC_IMAGE_CLIENT: LazyLock<reqwest::Result<reqwest::Client>> =
    LazyLock::new(|| client_builder(SystemLookup).build());

/// The shared client for public image fetches.
pub(super) fn public_image_client() -> anyhow::Result<&'static reqwest::Client> {
    PUBLIC_IMAGE_CLIENT
        .as_ref()
        .map_err(|error| anyhow::anyhow!("failed to build the public image client: {error}"))
}

fn client_builder(lookup: impl HostLookup) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        // A configured proxy would make the connection, bypassing the resolver.
        .no_proxy()
        .dns_resolver(Arc::new(PublicAddressResolver {
            lookup: Arc::new(lookup),
        }))
        .redirect(redirect::Policy::custom(follow_redirect))
}

fn follow_redirect(attempt: redirect::Attempt) -> redirect::Action {
    if attempt.previous().len() > MAX_REDIRECTS {
        return attempt.error("too many redirects");
    }

    if !is_fetchable(attempt.url()) {
        return attempt.error("redirect target is not a public http(s) URL");
    }

    attempt.follow()
}

/// An image URL that is not http(s), or whose host is a non-public IP literal.
#[derive(Debug, thiserror::Error)]
#[error("refusing to fetch an image from {host}: not a public http(s) address")]
pub(crate) struct RefusedImageUrl {
    pub(super) host: String,
}

/// Whether `url` is http(s) and its host is a name (checked when resolved)
/// or a public IP literal.
pub(super) fn is_fetchable(url: &Url) -> bool {
    if url.scheme() != "http" && url.scheme() != "https" {
        return false;
    }

    match url.host() {
        Some(Host::Domain(_)) => true,
        Some(Host::Ipv4(ip)) => !is_blocked_ip(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => !is_blocked_ip(IpAddr::V6(ip)),
        None => false,
    }
}

/// Answers a DNS name with its addresses.
trait HostLookup: Send + Sync + 'static {
    fn lookup(&self, host: &str) -> impl Future<Output = io::Result<Vec<SocketAddr>>> + Send;
}

struct SystemLookup;

impl HostLookup for SystemLookup {
    async fn lookup(&self, host: &str) -> io::Result<Vec<SocketAddr>> {
        // reqwest replaces the port with the URL's before connecting.
        Ok(tokio::net::lookup_host((host, 0)).await?.collect())
    }
}

/// Resolves names for reqwest, refusing any that resolve to a non-public
/// address.
struct PublicAddressResolver<Lookup> {
    lookup: Arc<Lookup>,
}

impl<Lookup: HostLookup> Resolve for PublicAddressResolver<Lookup> {
    fn resolve(&self, name: Name) -> Resolving {
        let lookup = Arc::clone(&self.lookup);
        Box::pin(async move {
            let host = name.as_str();
            let addresses = lookup.lookup(host).await?;

            // One internal address refuses the whole answer rather than
            // being dropped: a name that points inside is not an image host.
            if let Some(blocked) = addresses.iter().find(|address| is_blocked_ip(address.ip())) {
                tracing::warn!(
                    host,
                    ip = %blocked.ip(),
                    "refused an image host that resolves to a non-public address"
                );
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("{host} resolves to a non-public address"),
                )
                .into());
            }

            let addresses: Addrs = Box::new(addresses.into_iter());
            Ok(addresses)
        })
    }
}

/// Whether `ip` is anything but a public unicast address. IPv6 that wraps an
/// IPv4 address is judged as that IPv4 address.
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_blocked_ipv4(ip),
        IpAddr::V6(ip) => match embedded_ipv4(ip) {
            Some(ip) => is_blocked_ipv4(ip),
            None => is_blocked_ipv6(ip),
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

#[cfg(test)]
mod test;
