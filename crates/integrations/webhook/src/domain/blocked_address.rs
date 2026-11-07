//! Addresses and hosts webhook endpoints must never reach.
//!
//! Endpoint validation and the outbound connect-time resolver share these
//! rules.

#[cfg(test)]
mod test;

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Return whether `host` (a URL host string) names localhost or a blocked IP
/// literal. Domain names are judged by what they resolve to, elsewhere.
pub(crate) fn is_blocked_host(host: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }

    host.parse::<IpAddr>().is_ok_and(is_blocked_ip)
}

/// Return whether webhook delivery must never connect to `ip`.
///
/// IPv6 forms that embed an IPv4 address (mapped, compatible, NAT64, 6to4) are
/// judged by the embedded address.
pub(crate) fn is_blocked_ip(ip: IpAddr) -> bool {
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
    // Only global unicast 2000::/3 is public. Outside it are ::/16, multicast,
    // unique-local (including fd00:ec2::254 metadata), link-local, local-use
    // NAT64, SRv6 5f00::/16 and the unassigned space.
    (segments[0] & 0xe000) != 0x2000
        || segments[..2] == [0x2001, 0] // Teredo 2001::/32
        || segments[..3] == [0x2001, 0x0002, 0] // benchmarking 2001:2::/48
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
