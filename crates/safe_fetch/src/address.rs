//! Which IP addresses a fetch may connect to.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use ipnet::{IpNet, Ipv4Net, Ipv6Net};

/// IPv4 ranges that are not the public internet, from the IANA special-purpose
/// address registry. Anything here is internal infrastructure, a cloud metadata
/// service, or an address no public server legitimately uses.
const BLOCKED_IPV4: &[Ipv4Net] = &[
    // "This network"; 0.0.0.0 connects to the local host on Linux.
    Ipv4Net::new_assert(Ipv4Addr::new(0, 0, 0, 0), 8),
    Ipv4Net::new_assert(Ipv4Addr::new(10, 0, 0, 0), 8),
    // Carrier-grade NAT; also where Tailscale and some VPCs put hosts.
    Ipv4Net::new_assert(Ipv4Addr::new(100, 64, 0, 0), 10),
    Ipv4Net::new_assert(Ipv4Addr::new(127, 0, 0, 0), 8),
    // Link-local, including the 169.254.169.254 metadata endpoint.
    Ipv4Net::new_assert(Ipv4Addr::new(169, 254, 0, 0), 16),
    Ipv4Net::new_assert(Ipv4Addr::new(172, 16, 0, 0), 12),
    // IETF protocol assignments, including the 192.0.0.192 Oracle metadata endpoint.
    Ipv4Net::new_assert(Ipv4Addr::new(192, 0, 0, 0), 24),
    Ipv4Net::new_assert(Ipv4Addr::new(192, 0, 2, 0), 24),
    // Deprecated 6to4 relay anycast.
    Ipv4Net::new_assert(Ipv4Addr::new(192, 88, 99, 0), 24),
    Ipv4Net::new_assert(Ipv4Addr::new(192, 168, 0, 0), 16),
    // Benchmarking.
    Ipv4Net::new_assert(Ipv4Addr::new(198, 18, 0, 0), 15),
    Ipv4Net::new_assert(Ipv4Addr::new(198, 51, 100, 0), 24),
    Ipv4Net::new_assert(Ipv4Addr::new(203, 0, 113, 0), 24),
    // Multicast, reserved, and broadcast.
    Ipv4Net::new_assert(Ipv4Addr::new(224, 0, 0, 0), 3),
];

/// IPv6 ranges that are not the public internet. Ranges that embed an IPv4
/// address (mapped, NAT64) are not listed: [`embedded_ipv4`] unwraps them and
/// the IPv4 table decides.
const BLOCKED_IPV6: &[Ipv6Net] = &[
    // Unspecified, loopback, and the deprecated IPv4-compatible range.
    Ipv6Net::new_assert(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 0), 96),
    // Local-use NAT64.
    Ipv6Net::new_assert(Ipv6Addr::new(0x64, 0xff9b, 1, 0, 0, 0, 0, 0), 48),
    // Discard-only.
    Ipv6Net::new_assert(Ipv6Addr::new(0x100, 0, 0, 0, 0, 0, 0, 0), 64),
    // IETF protocol assignments, including Teredo.
    Ipv6Net::new_assert(Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23),
    Ipv6Net::new_assert(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
    // 6to4, which tunnels to an arbitrary embedded IPv4 address.
    Ipv6Net::new_assert(Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16),
    // Unique local, including the fd00:ec2::254 AWS metadata endpoint.
    Ipv6Net::new_assert(Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7),
    // Link-local and the deprecated site-local range.
    Ipv6Net::new_assert(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 9),
    Ipv6Net::new_assert(Ipv6Addr::new(0xff00, 0, 0, 0, 0, 0, 0, 0), 8),
];

/// The well-known NAT64 prefix: the last 32 bits are an IPv4 address.
const NAT64_WELL_KNOWN: Ipv6Net =
    Ipv6Net::new_assert(Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), 96);

/// Decides whether an address is one a fetch may connect to.
///
/// Every non-public range is refused unless the caller lists it in
/// [`AddressPolicy::private_networks_allowed`]. That list exists for local
/// development and tests; production callers leave it empty.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AddressPolicy {
    /// Non-public networks this caller may still reach.
    pub private_networks_allowed: Vec<IpNet>,
}

impl AddressPolicy {
    /// Only public internet addresses.
    #[must_use]
    pub fn public_only() -> Self {
        Self::default()
    }

    /// Whether a fetch may connect to `address`.
    #[must_use]
    pub fn allows(&self, address: IpAddr) -> bool {
        let address = canonical(address);

        let explicitly_allowed = self
            .private_networks_allowed
            .iter()
            .any(|network| network.contains(&address));
        if explicitly_allowed {
            return true;
        }

        !is_non_public(address)
    }
}

/// Whether `address` is outside the public internet.
#[must_use]
pub fn is_non_public(address: IpAddr) -> bool {
    match canonical(address) {
        IpAddr::V4(v4) => BLOCKED_IPV4.iter().any(|network| network.contains(&v4)),
        IpAddr::V6(v6) => BLOCKED_IPV6.iter().any(|network| network.contains(&v6)),
    }
}

/// Reduce an IPv6 address that only wraps an IPv4 one to that IPv4 address, so
/// `::ffff:127.0.0.1` and `64:ff9b::a9fe:a9fe` are judged as 127.0.0.1 and
/// 169.254.169.254.
fn canonical(address: IpAddr) -> IpAddr {
    match address {
        IpAddr::V4(_) => address,
        IpAddr::V6(v6) => embedded_ipv4(v6).map_or(address, IpAddr::V4),
    }
}

fn embedded_ipv4(address: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return Some(mapped);
    }

    if NAT64_WELL_KNOWN.contains(&address) {
        let [.., a, b, c, d] = address.octets();
        return Some(Ipv4Addr::new(a, b, c, d));
    }

    None
}

#[cfg(test)]
mod test;
