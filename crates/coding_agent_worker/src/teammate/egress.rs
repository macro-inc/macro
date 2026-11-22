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
//! 4. IPv6 neighbour discovery to link-local and link-scope multicast;
//! 5. every private, link-local, metadata, multicast and reserved range,
//!    the host's own addresses and on-link prefixes, the gateways and the
//!    install network's own prefixes: dropped, whatever the protocol;
//! 6. everything else (the public internet) accepted.
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

/// IPv6 router and neighbour discovery (ICMPv6 133 to 137), to link-local
/// and link-scope multicast only.
const NEIGHBOUR_DISCOVERY: &str = "ip6 daddr { fe80::/10, ff02::/16 } icmpv6 type { nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert, nd-redirect } accept";

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
    let (blocked4, blocked6) = blocked(facts);

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
    // IPv6 neighbour discovery on the link only, so v6 works on a bridge
    // that has it; every other fe80::/10 and ff00::/8 stays dropped.
    let _ = writeln!(text, "\t\t{NEIGHBOUR_DISCOVERY}");
    let _ = writeln!(text, "\t\tip daddr @blocked4 drop");
    let _ = writeln!(text, "\t\tip6 daddr @blocked6 drop");
    let _ = writeln!(text, "\t}}");
    let _ = writeln!(text, "}}");
    text
}

/// Every range the sets must hold, aggregated.
fn blocked(facts: &NetworkFacts) -> (Vec<Ipv4Net>, Vec<Ipv6Net>) {
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
    (Ipv4Net::aggregate(&blocked4), Ipv6Net::aggregate(&blocked6))
}

/// How a read-back table differs from the one rendered.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Mismatch {
    /// Not `nft -j` output.
    #[error("the read-back table is not nftables JSON")]
    Unreadable,
    /// No output chain with the filter type, hook, priority and policy.
    #[error("the output chain is missing or differs")]
    Chain,
    /// The rules differ in number, order or content.
    #[error("the rules differ from the rendered ones")]
    Rules,
    /// A range that must be dropped isn't in the sets.
    #[error("{0} is not in the blocked sets")]
    NotBlocked(IpNet),
}

/// Check `nft -j list table inet macro_teammate` against what [`ruleset`]
/// renders for the same input: the chain, every rule in order, and every
/// blocked range covered by the sets (which `auto-merge` may have joined).
pub fn verify(readback: &str, allow: &[Allow], facts: &NetworkFacts) -> Result<(), Mismatch> {
    let json: serde_json::Value =
        serde_json::from_str(readback).map_err(|_| Mismatch::Unreadable)?;
    let objects = json
        .get("nftables")
        .and_then(serde_json::Value::as_array)
        .ok_or(Mismatch::Unreadable)?;

    let chain_matches = objects
        .iter()
        .filter_map(|object| object.get("chain"))
        .any(|chain| {
            chain["name"] == "output"
                && chain["type"] == "filter"
                && chain["hook"] == "output"
                && chain["prio"] == 0
                && chain["policy"] == "accept"
        });
    if !chain_matches {
        return Err(Mismatch::Chain);
    }

    let rules: Vec<&serde_json::Value> = objects
        .iter()
        .filter_map(|object| object.get("rule"))
        .filter(|rule| rule["chain"] == "output")
        .map(|rule| &rule["expr"])
        .collect();
    let expected = expected_rules(allow, facts);
    if rules.len() != expected.len()
        || rules
            .iter()
            .zip(&expected)
            .any(|(rule, expected)| *rule != expected)
    {
        return Err(Mismatch::Rules);
    }

    let elements = |name: &str| -> Vec<(u128, u128, bool)> {
        objects
            .iter()
            .filter_map(|object| object.get("set"))
            .filter(|set| set["name"] == name)
            .flat_map(|set| set["elem"].as_array().cloned().unwrap_or_default())
            .filter_map(|element| element_range(&element))
            .collect()
    };
    let (blocked4, blocked6) = blocked(facts);
    let sets4 = elements("blocked4");
    let sets6 = elements("blocked6");
    let wanted = blocked4
        .into_iter()
        .map(IpNet::V4)
        .chain(blocked6.into_iter().map(IpNet::V6));
    for net in wanted {
        let (start, end, v4) = net_range(&net);
        let sets = if v4 { &sets4 } else { &sets6 };
        let covered = sets
            .iter()
            .any(|(first, last, family)| *family == v4 && *first <= start && end <= *last);
        if !covered {
            return Err(Mismatch::NotBlocked(net));
        }
    }
    Ok(())
}

/// The `expr` of each rule as `nft -j` prints it, in order.
fn expected_rules(allow: &[Allow], facts: &NetworkFacts) -> Vec<serde_json::Value> {
    use serde_json::json;

    let matches = |protocol: &str, field: &str, right: serde_json::Value| json!({ "match": { "op": "==", "left": { "payload": { "protocol": protocol, "field": field } }, "right": right } });
    let address = |net: &IpNet| -> serde_json::Value {
        if net.prefix_len() == net.max_prefix_len() {
            json!(net.addr().to_string())
        } else {
            json!({ "prefix": { "addr": net.network().to_string(), "len": net.prefix_len() } })
        }
    };
    let mut rules = vec![
        json!([{ "match": { "op": "==", "left": { "meta": { "key": "oif" } }, "right": "lo" } }, { "accept": null }]),
        json!([{ "match": { "op": "in", "left": { "ct": { "key": "state" } }, "right": ["established", "related"] } }, { "accept": null }]),
    ];
    for resolver in &facts.resolvers {
        for transport in ["udp", "tcp"] {
            rules.push(json!([
                matches(family(resolver), "daddr", json!(resolver.to_string())),
                matches(transport, "dport", json!(53)),
                { "accept": null },
            ]));
        }
    }
    for transport in ["udp", "tcp"] {
        rules.push(json!([matches(transport, "dport", json!(53)), { "drop": null }]));
    }
    for entry in allow {
        let family = match entry.network {
            IpNet::V4(_) => "ip",
            IpNet::V6(_) => "ip6",
        };
        let ports = match entry.ports.as_slice() {
            [port] => json!(port),
            ports => json!({ "set": ports }),
        };
        rules.push(json!([
            matches(family, "daddr", address(&entry.network)),
            matches("tcp", "dport", ports),
            { "accept": null },
        ]));
    }
    rules.push(json!([
        matches(
            "ip6",
            "daddr",
            json!({ "set": [
                { "prefix": { "addr": "fe80::", "len": 10 } },
                { "prefix": { "addr": "ff02::", "len": 16 } },
            ] })
        ),
        matches(
            "icmpv6",
            "type",
            json!({ "set": [
                "nd-router-solicit",
                "nd-router-advert",
                "nd-neighbor-solicit",
                "nd-neighbor-advert",
                "nd-redirect",
            ] })
        ),
        { "accept": null },
    ]));
    rules.push(json!([matches("ip", "daddr", json!("@blocked4")), { "drop": null }]));
    rules.push(json!([matches("ip6", "daddr", json!("@blocked6")), { "drop": null }]));
    rules
}

/// A set element as an inclusive range of addresses, with its family.
fn element_range(element: &serde_json::Value) -> Option<(u128, u128, bool)> {
    if let Some(text) = element.as_str() {
        let address: IpAddr = text.parse().ok()?;
        return Some(net_range(&IpNet::from(address)));
    }
    if let Some(prefix) = element.get("prefix") {
        let address: IpAddr = prefix["addr"].as_str()?.parse().ok()?;
        let length = u8::try_from(prefix["len"].as_u64()?).ok()?;
        return Some(net_range(&IpNet::new(address, length).ok()?));
    }
    let range = element.get("range")?.as_array()?;
    let first: IpAddr = range.first()?.as_str()?.parse().ok()?;
    let last: IpAddr = range.get(1)?.as_str()?.parse().ok()?;
    let (start, _, v4) = net_range(&IpNet::from(first));
    let (end, _, _) = net_range(&IpNet::from(last));
    Some((start, end, v4))
}

fn net_range(net: &IpNet) -> (u128, u128, bool) {
    match net.trunc() {
        IpNet::V4(net) => (
            u128::from(u32::from(net.network())),
            u128::from(u32::from(net.broadcast())),
            true,
        ),
        IpNet::V6(net) => (
            u128::from(net.network()),
            u128::from(net.broadcast()),
            false,
        ),
    }
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

/// What `nft -j list table` prints for [`ruleset`]'s output, for fakes
/// that have no nft.
#[cfg(test)]
pub(crate) fn simulated_readback(allow: &[Allow], facts: &NetworkFacts) -> String {
    use serde_json::json;

    let (blocked4, blocked6) = blocked(facts);
    let element = |net: IpNet| json!({ "prefix": { "addr": net.network().to_string(), "len": net.prefix_len() } });
    let mut objects = vec![
        json!({ "table": { "family": "inet", "name": TABLE } }),
        json!({ "chain": { "family": "inet", "table": TABLE, "name": "output", "type": "filter", "hook": "output", "prio": 0, "policy": "accept" } }),
        json!({ "set": { "name": "blocked4", "elem": blocked4.into_iter().map(|net| element(IpNet::V4(net))).collect::<Vec<_>>() } }),
        json!({ "set": { "name": "blocked6", "elem": blocked6.into_iter().map(|net| element(IpNet::V6(net))).collect::<Vec<_>>() } }),
    ];
    for expr in expected_rules(allow, facts) {
        objects.push(json!({ "rule": { "chain": "output", "expr": expr } }));
    }
    json!({ "nftables": objects }).to_string()
}
