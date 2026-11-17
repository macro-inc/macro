//! IPv4 ranges: Docker network subnets, host routes, and subnet blocks.

use std::net::Ipv4Addr;

#[cfg(test)]
mod test;

/// An IPv4 range, for overlap checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ipv4Range {
    first: u32,
    last: u32,
}

impl Ipv4Range {
    /// The range `address/prefix` covers; `None` for a prefix over 32.
    pub fn from_prefix(address: Ipv4Addr, prefix: u8) -> Option<Self> {
        if prefix > 32 {
            return None;
        }
        let mask = u32::MAX.checked_shl(u32::from(32 - prefix)).unwrap_or(0);
        let first = u32::from(address) & mask;
        Some(Ipv4Range {
            first,
            last: first | !mask,
        })
    }

    /// Parse `a.b.c.d/n`; IPv6 subnets aren't ranges we allocate from, so `None`.
    pub fn parse(cidr: &str) -> Option<Self> {
        let (address, prefix) = cidr.split_once('/')?;
        Self::from_prefix(address.parse().ok()?, prefix.parse().ok()?)
    }

    /// Whether the two ranges share an address.
    pub fn overlaps(self, other: Ipv4Range) -> bool {
        self.first <= other.last && other.first <= self.last
    }
}

/// The `/24` of subnet block `block`.
pub(crate) fn block_range(block: u8) -> Ipv4Range {
    let address = Ipv4Addr::from(u32::from_be_bytes([10, 254, block, 0]));
    Ipv4Range::from_prefix(address, 24).expect("24 is a valid IPv4 prefix")
}

/// This machine's IPv4 routes. Docker checks these when it picks a subnet
/// itself but not for one it's given, and a clash cuts this machine off from
/// whatever that route reaches (often a VPN). No routing table reads as none.
pub fn host_routes() -> Vec<Ipv4Range> {
    parse_routes(&std::fs::read_to_string("/proc/net/route").unwrap_or_default())
}

/// Routes from the kernel's `/proc/net/route` table. Default routes are skipped.
pub fn parse_routes(table: &str) -> Vec<Ipv4Range> {
    table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let destination = u32::from_str_radix(fields.get(1)?, 16).ok()?;
            let mask = u32::from_str_radix(fields.get(7)?, 16).ok()?;
            if mask == 0 {
                return None;
            }
            let address = Ipv4Addr::from(destination.swap_bytes());
            Ipv4Range::from_prefix(address, mask.count_ones() as u8)
        })
        .collect()
}
