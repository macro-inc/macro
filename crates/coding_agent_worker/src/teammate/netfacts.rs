//! Reading what a network namespace and the host look like, for the egress
//! ruleset: resolvers from `resolv.conf`, a network's subnets and gateways
//! from `docker|podman network inspect`, and the host's addresses and
//! on-link prefixes from `ip -j address show`.

use std::net::IpAddr;

use ipnet::IpNet;
use nom::Parser as _;
use serde_json::Value;

#[cfg(test)]
mod test;

/// The resolvers dockerd uses when the host's are all on loopback and
/// systemd-resolved lists none (its built-in default).
const DOCKER_DEFAULT_RESOLVERS: [&str; 4] = [
    "8.8.8.8",
    "8.8.4.4",
    "2001:4860:4860::8888",
    "2001:4860:4860::8844",
];

/// Where systemd-resolved lists the upstreams behind 127.0.0.53, which
/// dockerd reads in that case.
const RESOLVED_UPSTREAMS: &str = "/run/systemd/resolve/resolv.conf";

/// The `nameserver` addresses of a `resolv.conf`.
pub fn nameservers(text: &str) -> Vec<IpAddr> {
    text.lines()
        .filter_map(|line| {
            let mut line_parser = (
                nom::character::complete::space0::<&str, nom::error::Error<&str>>,
                nom::bytes::complete::tag("nameserver"),
                nom::character::complete::space1,
                nom::bytes::complete::take_till1(|character: char| character.is_whitespace()),
            );
            line_parser
                .parse(line)
                .ok()
                .map(|(_, (_, _, _, address))| address)
        })
        .filter_map(|address| address.parse().ok())
        .collect()
}

/// The upstreams Docker's embedded resolver forwards to from inside a
/// container's namespace: the host's resolvers, or systemd-resolved's when
/// the host's are on loopback, or dockerd's default.
pub fn docker_upstream_resolvers() -> Vec<IpAddr> {
    let read = |path: &str| {
        std::fs::read_to_string(path)
            .map(|text| nameservers(&text))
            .unwrap_or_default()
    };
    let host: Vec<IpAddr> = read("/etc/resolv.conf");
    let listed = if host.iter().all(IpAddr::is_loopback) {
        read(RESOLVED_UPSTREAMS)
    } else {
        host
    };
    upstreams_or_default(listed)
}

/// `listed` without loopback, or dockerd's default when nothing is left.
pub fn upstreams_or_default(listed: Vec<IpAddr>) -> Vec<IpAddr> {
    let upstreams: Vec<IpAddr> = listed
        .into_iter()
        .filter(|address| !address.is_loopback())
        .collect();
    if upstreams.is_empty() {
        return DOCKER_DEFAULT_RESOLVERS
            .iter()
            .filter_map(|address| address.parse().ok())
            .collect();
    }
    upstreams
}

/// A network's subnets and gateways, from Docker's (`IPAM.Config[]`:
/// `Subnet`, `Gateway`) or Podman's (`subnets[]`: `subnet`, `gateway`)
/// `network inspect --format '{{json .}}'`.
pub fn network_subnets(inspected: &str) -> Result<(Vec<IpNet>, Vec<IpAddr>), String> {
    let json: Value = serde_json::from_str(inspected).map_err(|error| error.to_string())?;
    // `podman network inspect` prints a list.
    let network = json
        .as_array()
        .and_then(|list| list.first())
        .unwrap_or(&json);
    let (entries, subnet_key, gateway_key) = match network.pointer("/IPAM/Config") {
        Some(Value::Array(entries)) => (entries.clone(), "Subnet", "Gateway"),
        _ => match network.get("subnets") {
            Some(Value::Array(entries)) => (entries.clone(), "subnet", "gateway"),
            _ => return Err("no subnets in the network".to_owned()),
        },
    };
    let mut prefixes = Vec::new();
    let mut gateways = Vec::new();
    for entry in &entries {
        if let Some(subnet) = entry.get(subnet_key).and_then(Value::as_str) {
            prefixes.push(
                subnet
                    .parse::<IpNet>()
                    .map_err(|error| format!("{subnet}: {error}"))?,
            );
        }
        if let Some(gateway) = entry.get(gateway_key).and_then(Value::as_str) {
            gateways.push(
                gateway
                    .parse::<IpAddr>()
                    .map_err(|error| format!("{gateway}: {error}"))?,
            );
        }
    }
    if prefixes.is_empty() {
        return Err("no subnets in the network".to_owned());
    }
    Ok((prefixes, gateways))
}

/// Every address of the host and the on-link prefix it sits in, v4 and v6,
/// from `ip -j address show` (loopback included: harmless, it is dropped
/// anyway off `lo`).
pub fn host_prefixes(json: &str) -> Result<Vec<IpNet>, String> {
    let interfaces: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let interfaces = interfaces.as_array().ok_or("not a list of interfaces")?;
    let mut prefixes = Vec::new();
    for interface in interfaces {
        let addresses = interface
            .get("addr_info")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for address in addresses {
            let (Some(local), Some(length)) = (
                address.get("local").and_then(Value::as_str),
                address.get("prefixlen").and_then(Value::as_u64),
            ) else {
                continue;
            };
            let local: IpAddr = local
                .parse()
                .map_err(|_| format!("{local} is not an address"))?;
            let length =
                u8::try_from(length).map_err(|_| format!("{length} is not a prefix length"))?;
            let on_link = IpNet::new(local, length).map_err(|error| error.to_string())?;
            prefixes.push(on_link.trunc());
            prefixes.push(IpNet::from(local));
        }
    }
    if prefixes.is_empty() {
        return Err("the host lists no addresses".to_owned());
    }
    Ok(prefixes)
}

/// A host's routing table, for the ruleset.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Routes {
    /// The destinations of every route but the defaults (and a VPN's split
    /// defaults): a VPN's or a static route's network can be an internal
    /// one on public addresses, and the host's own and broadcast routes are
    /// its addresses. A destination without a length is one address.
    pub destinations: Vec<IpNet>,
    /// Whether a default (or split default) route is there: without one in
    /// either family the host's routes all go to networks the ruleset
    /// drops, so the agent reaches nothing.
    pub to_the_internet: bool,
}

/// The routes of `ip -j route show table all` (v4) or `ip -j -6 route show
/// table all`.
pub fn routes(json: &str) -> Result<Routes, String> {
    let listed: Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let listed = listed.as_array().ok_or("not a list of routes")?;
    let mut routes = Routes::default();
    for route in listed {
        let Some(destination) = route.get("dst").and_then(Value::as_str) else {
            continue;
        };
        // `unreachable`, `blackhole`, `prohibit` and `throw` routes send
        // nothing anywhere; a plain one has no type, or `unicast`.
        let forwards = route
            .get("type")
            .and_then(Value::as_str)
            .is_none_or(|kind| kind == "unicast");
        if destination == "default" {
            routes.to_the_internet |= forwards;
            continue;
        }
        let net = match destination.parse::<IpNet>() {
            Ok(net) => net,
            Err(_) => IpNet::from(
                destination
                    .parse::<IpAddr>()
                    .map_err(|_| format!("{destination} is not a destination"))?,
            ),
        };
        if covers_the_internet(&net) {
            routes.to_the_internet |= forwards;
            continue;
        }
        routes.destinations.push(net.trunc());
    }
    Ok(routes)
}

/// A route a VPN uses in place of the default: OpenVPN's `def1` splits the
/// IPv4 default into two `/1`s, and IPv6 VPNs route `::/1` or `2000::/3`
/// (all global unicast). Like the default, it is the internet, not one
/// internal network.
fn covers_the_internet(net: &IpNet) -> bool {
    match net {
        IpNet::V4(net) => net.prefix_len() <= 1,
        IpNet::V6(net) => net.prefix_len() <= 3,
    }
}

/// The service address and port pairs an agent environment names: the
/// host and port of every URL value (`http`, `https`, `ws`, `wss`), the
/// scheme's port when none is given. On a local stack these, and nothing
/// else of the stack's network, are allowed.
pub fn service_endpoints(agent_env: &str) -> Vec<(String, u16)> {
    let mut endpoints: Vec<(String, u16)> = teammate_lifecycle::runner::settings::values(agent_env)
        .values()
        .filter_map(|value| url::Url::parse(value).ok())
        .filter(|url| matches!(url.scheme(), "http" | "https" | "ws" | "wss"))
        .filter_map(|url| {
            Some((
                url.host_str()?.trim_matches(['[', ']']).to_owned(),
                url.port_or_known_default()?,
            ))
        })
        .collect();
    endpoints.sort();
    endpoints.dedup();
    endpoints
}

/// The IPv4 and IPv6 addresses `getent ahosts` printed.
pub fn resolved_addresses(getent: &str) -> Vec<IpAddr> {
    let mut addresses: Vec<IpAddr> = getent
        .lines()
        .filter_map(|line| line.split_whitespace().next())
        .filter_map(|address| address.parse().ok())
        .collect();
    addresses.sort();
    addresses.dedup();
    addresses
}
