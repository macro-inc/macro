use super::*;

fn net(text: &str) -> IpNet {
    text.parse().unwrap()
}

#[test]
fn the_ruleset_for_one_install() {
    let facts = NetworkFacts {
        resolvers: vec!["8.8.8.8".parse().unwrap()],
        host_prefixes: vec![net("81.2.69.160/29"), net("2a01:4f8:1:2::/64")],
        gateways: vec!["9.9.9.1".parse().unwrap()],
        network_prefixes: vec![net("172.31.5.0/24")],
    };
    let allow = [Allow::new(net("10.20.0.5/32"), vec![8101, 8102]).unwrap()];

    assert_eq!(
        ruleset(&allow, &facts),
        "table inet macro_teammate {}
delete table inet macro_teammate
table inet macro_teammate {
\tset blocked4 {
\t\ttype ipv4_addr; flags interval; auto-merge;
\t\telements = { 0.0.0.0/8, 9.9.9.1/32, 10.0.0.0/8, 81.2.69.160/29, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/3 }
\t}
\tset blocked6 {
\t\ttype ipv6_addr; flags interval; auto-merge;
\t\telements = { ::1/128, ::ffff:0.0.0.0/96, 64:ff9b::/96, 64:ff9b:1::/48, 2001:db8::/32, 2a01:4f8:1:2::/64, fc00::/7, fe80::/10, ff00::/8 }
\t}
\tchain output {
\t\ttype filter hook output priority 0; policy accept;
\t\toif \"lo\" accept
\t\tct state established,related accept
\t\tip daddr 8.8.8.8 udp dport 53 accept
\t\tip daddr 8.8.8.8 tcp dport 53 accept
\t\tudp dport 53 drop
\t\ttcp dport 53 drop
\t\tip daddr 10.20.0.5/32 tcp dport { 8101, 8102 } accept
\t\tip6 daddr { fe80::/10, ff02::/16 } icmpv6 type { nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert, nd-redirect } accept
\t\tip daddr @blocked4 drop
\t\tip6 daddr @blocked6 drop
\t}
}
"
    );
}

#[test]
fn allow_entries_never_open_everything_loopback_or_metadata() {
    assert!(Allow::new(net("10.20.0.5/32"), vec![8101]).is_ok());
    assert_eq!(
        Allow::new(net("0.0.0.0/0"), vec![443]),
        Err(InvalidAllow::Everything(net("0.0.0.0/0")))
    );
    assert_eq!(
        Allow::new(net("10.20.0.5/32"), vec![]),
        Err(InvalidAllow::NoPorts(net("10.20.0.5/32")))
    );
    assert_eq!(
        Allow::new(net("10.20.0.5/32"), vec![0]),
        Err(InvalidAllow::PortZero(net("10.20.0.5/32")))
    );
    assert_eq!(
        Allow::new(net("127.0.0.1/32"), vec![80]),
        Err(InvalidAllow::Loopback(net("127.0.0.1/32")))
    );
    assert_eq!(
        Allow::new(net("169.254.169.254/32"), vec![80]),
        Err(InvalidAllow::Metadata(net("169.254.169.254/32")))
    );
    // A wide entry that would cover the metadata address.
    assert_eq!(
        Allow::new(net("169.0.0.0/8"), vec![80]),
        Err(InvalidAllow::Metadata(net("169.0.0.0/8")))
    );
    assert_eq!(
        Allow::new(net("fd00::/8"), vec![80]),
        Err(InvalidAllow::Metadata(net("fd00::/8")))
    );
}

#[test]
fn only_the_listed_resolvers_get_dns() {
    let text = ruleset(
        &[],
        &NetworkFacts {
            resolvers: vec!["192.168.1.1".parse().unwrap(), "fd00::53".parse().unwrap()],
            ..NetworkFacts::default()
        },
    );
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let position = |line: &str| {
        lines
            .iter()
            .position(|candidate| *candidate == line)
            .unwrap()
    };
    // A resolver on a private address is allowed before the drops.
    assert!(position("ip daddr 192.168.1.1 udp dport 53 accept") < position("udp dport 53 drop"));
    assert!(position("ip6 daddr fd00::53 tcp dport 53 accept") < position("tcp dport 53 drop"));
    assert!(position("tcp dport 53 drop") < position("ip daddr @blocked4 drop"));
}

/// What `nft -j list table inet macro_teammate` printed after loading the
/// ruleset for [`readback_inputs`] (nftables 1.1.6, in a user namespace).
const READBACK: &str = include_str!("readback.json");

fn readback_inputs() -> (Vec<Allow>, NetworkFacts) {
    (
        vec![
            Allow::new(net("10.20.0.5/32"), vec![8101]).unwrap(),
            Allow::new(net("fd12::5/128"), vec![443]).unwrap(),
        ],
        NetworkFacts {
            resolvers: vec!["8.8.8.8".parse().unwrap(), "fd00::53".parse().unwrap()],
            host_prefixes: vec![net("192.168.1.0/24"), net("2a01:4f8:1:2::/64")],
            gateways: vec!["172.18.0.1".parse().unwrap()],
            network_prefixes: vec![net("172.18.0.0/16")],
        },
    )
}

#[test]
fn the_loaded_ruleset_reads_back_as_rendered() {
    let (allow, facts) = readback_inputs();
    assert_eq!(verify(READBACK, &allow, &facts), Ok(()));
}

#[test]
fn a_readback_missing_a_rule_or_a_blocked_prefix_is_refused() {
    let (allow, facts) = readback_inputs();

    // The DNS drop gone: a resolver could be bypassed.
    let mut json: serde_json::Value = serde_json::from_str(READBACK).unwrap();
    let objects = json["nftables"].as_array_mut().unwrap();
    let dns_drop = objects
        .iter()
        .position(|object| {
            object.to_string().contains("\"drop\"") && object.to_string().contains("\"udp\"")
        })
        .unwrap();
    objects.remove(dns_drop);
    assert!(matches!(
        verify(&json.to_string(), &allow, &facts),
        Err(Mismatch::Rules)
    ));

    // The host moved to a new on-link prefix the loaded sets don't cover.
    let moved = NetworkFacts {
        host_prefixes: vec![net("81.2.69.160/29")],
        ..facts.clone()
    };
    assert!(matches!(
        verify(READBACK, &allow, &moved),
        Err(Mismatch::NotBlocked(prefix)) if prefix == net("81.2.69.160/29")
    ));

    // Another chain policy, or no table at all.
    assert!(matches!(
        verify(
            &READBACK
                .replace("\"policy\": \"accept\"", "\"policy\": \"drop\"")
                .replace("\"policy\":\"accept\"", "\"policy\":\"drop\""),
            &allow,
            &facts
        ),
        Err(Mismatch::Chain)
    ));
    assert!(matches!(
        verify(r#"{"nftables": []}"#, &allow, &facts),
        Err(Mismatch::Chain)
    ));
    assert!(matches!(
        verify("not json", &allow, &facts),
        Err(Mismatch::Unreadable)
    ));
}

#[test]
fn ipv6_neighbour_discovery_is_allowed_on_link_only() {
    let text = ruleset(&[], &NetworkFacts::default());
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let position = |line: &str| {
        lines
            .iter()
            .position(|candidate| *candidate == line)
            .unwrap()
    };
    let discovery = position(
        "ip6 daddr { fe80::/10, ff02::/16 } icmpv6 type { nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert, nd-redirect } accept",
    );
    // Before the drops (which keep every other fe80::/10 and ff00::/8).
    assert!(discovery < position("ip6 daddr @blocked6 drop"));
    assert!(text.contains("fe80::/10") && text.contains("ff00::/8"));
}
