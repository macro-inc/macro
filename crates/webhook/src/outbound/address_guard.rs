//! Blocked-address classification and the connect-time resolver that enforces it.
//!
//! The preflight check in `http_validator` gives users a clear message, but
//! the resolver is what the HTTP client connects through, so a DNS answer that
//! changes between preflight and connect is still filtered.

#[cfg(test)]
#[path = "address_guard_test.rs"]
mod address_guard_test;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::{
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
};

/// Resolves names through the operating system resolver.
pub(super) struct SystemResolver;

impl Resolve for SystemResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            // reqwest replaces the port with the URL's port before connecting.
            let addresses = tokio::net::lookup_host((name.as_str(), 0)).await?;
            let addresses: Addrs = Box::new(addresses.collect::<Vec<_>>().into_iter());
            Ok(addresses)
        })
    }
}

/// Drops blocked addresses from every answer and fails when none remain.
pub(super) struct BlockedAddressFilteringResolver {
    pub(super) inner: Arc<dyn Resolve>,
}

impl Resolve for BlockedAddressFilteringResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        let resolving = self.inner.resolve(name);
        Box::pin(async move {
            let allowed: Vec<SocketAddr> = resolving
                .await?
                .filter(|address| !is_blocked_ip(address.ip()))
                .collect();
            if allowed.is_empty() {
                tracing::warn!(
                    host = %host,
                    "webhook endpoint resolved only to blocked addresses at connect time"
                );
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "webhook endpoint resolved only to blocked addresses",
                )
                .into());
            }
            let allowed: Addrs = Box::new(allowed.into_iter());
            Ok(allowed)
        })
    }
}

/// Return whether webhook delivery must never connect to `ip`.
///
/// IPv6 forms that embed an IPv4 address (mapped, compatible, NAT64, 6to4) are
/// judged by the embedded address.
pub(super) fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_blocked_ipv4(ip),
        IpAddr::V6(ip) => is_blocked_ipv6(ip),
    }
}

fn is_blocked_ipv4(ip: Ipv4Addr) -> bool {
    let [first, second, third, _] = ip.octets();
    first == 0 // "this network", including 0.0.0.0
        || ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local() // includes 169.254.169.254 metadata
        || (first == 100 && (second & 0xc0) == 64) // CGNAT 100.64.0.0/10
        || (first == 192 && second == 0 && third == 0) // IETF protocol assignments
        || (first == 198 && (second & 0xfe) == 18) // benchmarking 198.18.0.0/15
        || ip.is_documentation()
        || ip.is_multicast()
        || first >= 240 // reserved 240.0.0.0/4 and broadcast
}

fn is_blocked_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(embedded) = embedded_ipv4(ip) {
        return is_blocked_ipv4(embedded);
    }

    let segments = ip.segments();
    segments[0] == 0 // ::/16: unspecified, loopback, deprecated IPv4-compatible
        || ip.is_multicast()
        || ip.is_unique_local() // includes fd00:ec2::254 metadata
        || (segments[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        || (segments[0] & 0xffc0) == 0xfec0 // site-local fec0::/10
        || segments[..4] == [0x0100, 0, 0, 0] // discard 100::/64
        || segments[..3] == [0x0064, 0xff9b, 0x0001] // local-use NAT64 64:ff9b:1::/48
        || segments[..2] == [0x2001, 0] // Teredo 2001::/32
        || segments[..2] == [0x2001, 0x0db8] // documentation 2001:db8::/32
        || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0) // documentation 3fff::/20
}

/// IPv4 address wrapped by an IPv4-mapped, NAT64 or 6to4 IPv6 address.
fn embedded_ipv4(ip: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return Some(mapped);
    }

    let segments = ip.segments();
    if segments[..6] == [0x0064, 0xff9b, 0, 0, 0, 0] {
        // NAT64 well-known prefix 64:ff9b::/96
        return Some(ipv4_from_segments(segments[6], segments[7]));
    }
    if segments[0] == 0x2002 {
        // 6to4 2002:AABB:CCDD::/48 wraps AA.BB.CC.DD
        return Some(ipv4_from_segments(segments[1], segments[2]));
    }
    None
}

fn ipv4_from_segments(high: u16, low: u16) -> Ipv4Addr {
    Ipv4Addr::from((u32::from(high) << 16) | u32::from(low))
}
