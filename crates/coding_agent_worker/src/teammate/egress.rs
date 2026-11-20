//! The teammate's egress policy as one nftables ruleset, loaded by the
//! guard into the install's own network namespace (the holder's), before
//! the agent starts (docs/design/teammate-runtime.md, *Network*; plan:
//! enforced egress).
//!
//! Output hook, in order:
//!
//! 1. loopback, and replies to connections already accepted;
//! 2. DNS (port 53) only to the exact resolvers; any other port 53 dropped;
//! 3. the explicit `[[teammates.allow]]` entries (and a local stack's
//!    service host:port pairs);
//! 4. every private, link-local, metadata, multicast and reserved range,
//!    the host's own addresses and on-link prefixes, the gateways and the
//!    install network's own prefixes: dropped, whatever the protocol;
//! 5. everything else (the public internet) accepted.
//!
//! The filter is on the destination address after DNS, so rebinding,
//! redirects, a proxy's CONNECT and odd IP spellings all end in a dropped
//! connect.

use std::fmt::Write as _;
use std::net::IpAddr;

use ipnet::{IpNet, Ipv4Net, Ipv6Net};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// The ruleset's table, as the guard reads it back.
pub const TABLE: &str = "macro_teammate";

/// IPv4 ranges a teammate never reaches.
pub const BLOCKED_IPV4: [&str; 14] = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
];

/// IPv6 ranges a teammate never reaches.
pub const BLOCKED_IPV6: [&str; 8] = [
    "::1/128",
    "::ffff:0:0/96",
    "64:ff9b::/96",
    "64:ff9b:1::/48",
    "2001:db8::/32",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
];

/// The metadata addresses no allow entry may cover.
const METADATA: [&str; 2] = ["169.254.0.0/16", "fd00:ec2::254/128"];

/// Loopback, which no allow entry may cover (loopback is always allowed).
const LOOPBACK: [&str; 2] = ["127.0.0.0/8", "::1/128"];

/// One explicit exception: TCP to these ports of this network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Allow {
    /// The destination network, e.g. `10.20.0.5/32`.
    pub network: IpNet,
    /// The TCP ports, at least one.
    pub ports: Vec<u16>,
}

/// An allow entry the policy refuses.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InvalidAllow {
    /// No ports: an entry never opens a whole network.
    #[error("{0} names no ports")]
    NoPorts(IpNet),
    /// Port 0.
    #[error("{0} names port 0")]
    PortZero(IpNet),
    /// A /0: everything.
    #[error("{0} is everything")]
    Everything(IpNet),
    /// Overlaps loopback.
    #[error("{0} overlaps loopback")]
    Loopback(IpNet),
    /// Overlaps a metadata address.
    #[error("{0} overlaps a cloud metadata address")]
    Metadata(IpNet),
}

fn parse(net: &str) -> Option<IpNet> {
    net.parse().ok()
}

fn overlaps(first: &IpNet, second: &IpNet) -> bool {
    first.contains(&second.network()) || second.contains(&first.network())
}

impl Allow {
    /// The entry, if the policy takes it.
    pub fn new(network: IpNet, ports: Vec<u16>) -> Result<Self, InvalidAllow> {
        let network = network.trunc();
        if network.prefix_len() == 0 {
            return Err(InvalidAllow::Everything(network));
        }
        if ports.is_empty() {
            return Err(InvalidAllow::NoPorts(network));
        }
        if ports.contains(&0) {
            return Err(InvalidAllow::PortZero(network));
        }
        if LOOPBACK
            .iter()
            .filter_map(|net| parse(net))
            .any(|loopback| overlaps(&loopback, &network))
        {
            return Err(InvalidAllow::Loopback(network));
        }
        if METADATA
            .iter()
            .filter_map(|net| parse(net))
            .any(|metadata| overlaps(&metadata, &network))
        {
            return Err(InvalidAllow::Metadata(network));
        }
        Ok(Self { network, ports })
    }

    /// Check an entry read from a config file.
    pub fn validated(self) -> Result<Self, InvalidAllow> {
        Self::new(self.network, self.ports)
    }
}

/// What macrod learned about this install's network at this start.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkFacts {
    /// The exact resolvers DNS may go to (the namespace's own, and the
    /// upstreams an embedded resolver forwards to from inside it).
    pub resolvers: Vec<IpAddr>,
    /// The host's own addresses and on-link prefixes, v4 and v6, read at
    /// this start.
    pub host_prefixes: Vec<IpNet>,
    /// The namespace's gateways.
    pub gateways: Vec<IpAddr>,
    /// The install network's own prefixes (and any other network the
    /// holder joins).
    pub network_prefixes: Vec<IpNet>,
}

/// The ruleset for `allow` and `facts`, as `nft -f` reads it.
pub fn ruleset(allow: &[Allow], facts: &NetworkFacts) -> String {
    let mut blocked4: Vec<Ipv4Net> = BLOCKED_IPV4
        .iter()
        .filter_map(|net| net.parse().ok())
        .collect();
    let mut blocked6: Vec<Ipv6Net> = BLOCKED_IPV6
        .iter()
        .filter_map(|net| net.parse().ok())
        .collect();
    let gateways = facts.gateways.iter().map(|gateway| IpNet::from(*gateway));
    for net in facts
        .host_prefixes
        .iter()
        .chain(&facts.network_prefixes)
        .copied()
        .chain(gateways)
    {
        match net.trunc() {
            IpNet::V4(net) => blocked4.push(net),
            IpNet::V6(net) => blocked6.push(net),
        }
    }
    let blocked4 = Ipv4Net::aggregate(&blocked4);
    let blocked6 = Ipv6Net::aggregate(&blocked6);

    let mut text = String::new();
    // A first `table ... {}` and `delete` make a reload replace the table
    // whole, in one transaction.
    let _ = writeln!(text, "table inet {TABLE} {{}}");
    let _ = writeln!(text, "delete table inet {TABLE}");
    let _ = writeln!(text, "table inet {TABLE} {{");
    write_set(
        &mut text,
        "blocked4",
        "ipv4_addr",
        blocked4.iter().map(ToString::to_string),
    );
    write_set(
        &mut text,
        "blocked6",
        "ipv6_addr",
        blocked6.iter().map(ToString::to_string),
    );
    let _ = writeln!(text, "\tchain output {{");
    let _ = writeln!(
        text,
        "\t\ttype filter hook output priority 0; policy accept;"
    );
    let _ = writeln!(text, "\t\toif \"lo\" accept");
    let _ = writeln!(text, "\t\tct state established,related accept");
    for resolver in &facts.resolvers {
        let family = family(resolver);
        let _ = writeln!(text, "\t\t{family} daddr {resolver} udp dport 53 accept");
        let _ = writeln!(text, "\t\t{family} daddr {resolver} tcp dport 53 accept");
    }
    let _ = writeln!(text, "\t\tudp dport 53 drop");
    let _ = writeln!(text, "\t\ttcp dport 53 drop");
    for entry in allow {
        let family = match entry.network {
            IpNet::V4(_) => "ip",
            IpNet::V6(_) => "ip6",
        };
        let ports: Vec<String> = entry.ports.iter().map(ToString::to_string).collect();
        let _ = writeln!(
            text,
            "\t\t{family} daddr {} tcp dport {{ {} }} accept",
            entry.network,
            ports.join(", ")
        );
    }
    let _ = writeln!(text, "\t\tip daddr @blocked4 drop");
    let _ = writeln!(text, "\t\tip6 daddr @blocked6 drop");
    let _ = writeln!(text, "\t}}");
    let _ = writeln!(text, "}}");
    text
}

fn family(address: &IpAddr) -> &'static str {
    match address {
        IpAddr::V4(_) => "ip",
        IpAddr::V6(_) => "ip6",
    }
}

fn write_set(text: &mut String, name: &str, kind: &str, elements: impl Iterator<Item = String>) {
    let elements: Vec<String> = elements.collect();
    let _ = writeln!(text, "\tset {name} {{");
    let _ = writeln!(text, "\t\ttype {kind}; flags interval; auto-merge;");
    let _ = writeln!(text, "\t\telements = {{ {} }}", elements.join(", "));
    let _ = writeln!(text, "\t}}");
}
