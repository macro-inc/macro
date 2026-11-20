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
