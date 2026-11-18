//! Which addresses connections to a user's MCP server may reach.

use macro_env::Environment;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[cfg(test)]
mod test;

/// Which addresses MCP traffic may connect to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressPolicy {
    /// Only public unicast addresses.
    PublicOnly,
    /// Any address, for local development against servers on this machine
    /// or the Docker network.
    AnyAddress,
}

impl AddressPolicy {
    /// Local development reaches local servers; every deployed environment
    /// is public-only.
    pub fn for_environment(environment: Environment) -> Self {
        match environment {
            Environment::Local => Self::AnyAddress,
            Environment::Develop | Environment::Production => Self::PublicOnly,
        }
    }

    pub(crate) fn allows(self, address: IpAddr) -> bool {
        match self {
            Self::AnyAddress => true,
            Self::PublicOnly => is_public(address),
        }
    }
}

/// The URL names a host the policy refuses.
#[derive(Debug, thiserror::Error)]
#[error("refusing to connect to `{host}`: not a public address")]
pub struct RefusedAddress {
    pub(crate) host: String,
}

/// Whether `address` is public unicast. IPv6 that wraps an IPv4 address
/// (mapped, compatible, NAT64) is judged as that IPv4 address.
pub(crate) fn is_public(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match embedded_v4(v6) {
            Some(v4) => is_public_v4(v4),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0 // "this network"
        || address.is_private()
        || address.is_loopback()
        || address.is_link_local() // includes instance metadata
        || (a == 100 && (64..=127).contains(&b)) // CGNAT
        || (a == 192 && b == 0 && c == 0) // IETF protocol assignments
        || address.is_documentation()
        || (a == 198 && (b == 18 || b == 19)) // benchmarking
        || address.is_multicast()
        || a >= 240) // reserved and broadcast
}

fn embedded_v4(address: Ipv6Addr) -> Option<Ipv4Addr> {
    let [a, b, c, d, e, f, g, h] = address.segments();
    let low = Ipv4Addr::from((u32::from(g) << 16) | u32::from(h));
    match [a, b, c, d, e, f] {
        // Mapped, NAT64 well-known prefix, and the deprecated compatible form.
        [0, 0, 0, 0, 0, 0xffff] | [0x64, 0xff9b, 0, 0, 0, 0] | [0, 0, 0, 0, 0, 0] => Some(low),
        _ => None,
    }
}

fn is_public_v6(address: Ipv6Addr) -> bool {
    let [a, b, ..] = address.segments();
    // Global unicast only, minus the special ranges inside it.
    (a & 0xe000) == 0x2000
        && !(a == 0x2001 && b < 0x0200) // IETF assignments: Teredo, benchmarking, ORCHID
        && !(a == 0x2001 && b == 0x0db8) // documentation
        && !(a == 0x3fff && b < 0x1000) // documentation, 3fff::/20
        && a != 0x2002 // 6to4 wraps an arbitrary IPv4 address
}
