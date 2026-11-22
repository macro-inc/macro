use super::*;

#[test]
fn nameservers_are_read_from_resolv_conf() {
    assert_eq!(
        nameservers(
            "# generated\nsearch lan\nnameserver 127.0.0.11\n  nameserver\t192.168.1.1\nnameserver fd00::53\noptions ndots:0\nnameserver nonsense\n"
        ),
        [
            "127.0.0.11".parse::<IpAddr>().unwrap(),
            "192.168.1.1".parse().unwrap(),
            "fd00::53".parse().unwrap()
        ]
    );
}

#[test]
fn docker_falls_back_to_its_default_upstreams() {
    assert_eq!(
        upstreams_or_default(vec!["127.0.0.53".parse().unwrap()]),
        DOCKER_DEFAULT_RESOLVERS.map(|address| address.parse::<IpAddr>().unwrap())
    );
    assert_eq!(
        upstreams_or_default(vec!["192.168.1.1".parse().unwrap()]),
        ["192.168.1.1".parse::<IpAddr>().unwrap()]
    );
}

#[test]
fn a_docker_and_a_podman_network_read_alike() {
    let docker = r#"{"Name":"macro-teammate-i","IPAM":{"Driver":"default","Config":[{"Subnet":"172.20.0.0/16","Gateway":"172.20.0.1"}]}}"#;
    let podman = r#"[{"name":"macro-teammate-i","driver":"bridge","subnets":[{"subnet":"10.89.0.0/24","gateway":"10.89.0.1"},{"subnet":"fd12::/64","gateway":"fd12::1"}]}]"#;
    assert_eq!(
        network_subnets(docker).unwrap(),
        (
            vec!["172.20.0.0/16".parse().unwrap()],
            vec!["172.20.0.1".parse().unwrap()]
        )
    );
    assert_eq!(
        network_subnets(podman).unwrap(),
        (
            vec![
                "10.89.0.0/24".parse().unwrap(),
                "fd12::/64".parse().unwrap()
            ],
            vec!["10.89.0.1".parse().unwrap(), "fd12::1".parse().unwrap()]
        )
    );
    assert!(network_subnets(r#"{"Name":"x","IPAM":{"Config":[]}}"#).is_err());
}

#[test]
fn the_host_gives_its_addresses_and_their_on_link_prefixes() {
    let json = r#"[{"ifname":"lo","addr_info":[{"family":"inet","local":"127.0.0.1","prefixlen":8}]},{"ifname":"eth0","addr_info":[{"family":"inet","local":"81.2.69.162","prefixlen":29},{"family":"inet6","local":"2a01:4f8:1:2::5","prefixlen":64},{"family":"inet6","local":"fe80::1","prefixlen":64}]}]"#;
    let prefixes = host_prefixes(json).unwrap();
    for wanted in [
        "81.2.69.160/29",
        "81.2.69.162/32",
        "2a01:4f8:1:2::/64",
        "2a01:4f8:1:2::5/128",
    ] {
        assert!(
            prefixes.contains(&wanted.parse().unwrap()),
            "{wanted}: {prefixes:?}"
        );
    }
    assert!(host_prefixes("[]").is_err());
}

#[test]
fn a_local_stacks_service_endpoints_are_read_from_the_agent_env() {
    let agent_env = "MACRO_API_KEY=\"mak_secret\"\nOVERRIDE_AUTH_SERVICE_URL=\"http://authentication-service:8080\"\nOVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL=\"ws://connection-gateway:8080\"\nMACRO_GATEWAY=\"https://wolf-macro-google:27409\"\nOTEL_EXPORTER_OTLP_ENDPOINT=\"http://otel-collector:4318\"\nMACRO_REPO_URL=\"http://agent-harness-service:8080/agent-git/teammate.git\"\nANTHROPIC_BASE_URL=\"http://agent-harness-service:8102/brain\"\nPLAIN=\"https://example.com\"\n";
    assert_eq!(
        service_endpoints(agent_env),
        [
            ("agent-harness-service".to_owned(), 8080),
            ("agent-harness-service".to_owned(), 8102),
            ("authentication-service".to_owned(), 8080),
            ("connection-gateway".to_owned(), 8080),
            ("example.com".to_owned(), 443),
            ("otel-collector".to_owned(), 4318),
            ("wolf-macro-google".to_owned(), 27409),
        ]
    );
}

#[test]
fn getent_ahosts_gives_each_address_once() {
    assert_eq!(
        resolved_addresses(
            "172.20.0.9      STREAM proxy\n172.20.0.9      DGRAM  \n172.20.0.9      RAW    \nfd12::9 STREAM proxy\n"
        ),
        [
            "172.20.0.9".parse::<IpAddr>().unwrap(),
            "fd12::9".parse().unwrap()
        ]
    );
}

#[test]
fn the_destinations_of_every_route_but_the_default_are_dropped() {
    // A VPN's route to a public-address internal network, a host route, a
    // v6 route, and the defaults (which are the internet: kept).
    let v4 = r#"[{"dst":"default","gateway":"192.168.1.1","dev":"eth0"},{"dst":"44.31.0.0/16","dev":"wg0"},{"dst":"100.65.55.109","dev":"tailscale0","table":"52"},{"type":"local","dst":"192.168.1.5","dev":"eth0","table":"local"}]"#;
    let v6 = r#"[{"dst":"default","gateway":"fe80::1","dev":"eth0"},{"dst":"2a0a:e5c0:fff::/48","dev":"wg0"}]"#;
    let mut destinations = destinations_of(v4);
    destinations.extend(destinations_of(v6));
    assert_eq!(
        destinations,
        [
            "44.31.0.0/16".parse::<IpNet>().unwrap(),
            "100.65.55.109/32".parse().unwrap(),
            "192.168.1.5/32".parse().unwrap(),
            "2a0a:e5c0:fff::/48".parse().unwrap(),
        ]
    );
    assert!(super::routes("{}").is_err());
}

#[test]
fn a_vpn_that_splits_the_default_route_is_still_the_internet() {
    // OpenVPN's def1 (and the v6 equivalent, 2000::/3) replace the default
    // with routes that cover the whole internet; dropping them would cut
    // the agent off everything.
    let v4 = r#"[{"dst":"0.0.0.0/1","dev":"tun0"},{"dst":"128.0.0.0/1","dev":"tun0"},{"dst":"10.8.0.0/24","dev":"tun0"}]"#;
    let v6 = r#"[{"dst":"::/1","dev":"tun0"},{"dst":"2000::/3","dev":"tun0"},{"dst":"fd00:8::/64","dev":"tun0"}]"#;
    let mut destinations = destinations_of(v4);
    destinations.extend(destinations_of(v6));
    assert_eq!(
        destinations,
        [
            "10.8.0.0/24".parse::<IpNet>().unwrap(),
            "fd00:8::/64".parse().unwrap(),
        ]
    );
}

fn destinations_of(json: &str) -> Vec<IpNet> {
    super::routes(json).unwrap().destinations
}

#[test]
fn a_default_or_split_default_route_goes_to_the_internet() {
    let default = r#"[{"dst":"default","gateway":"192.168.1.1","dev":"eth0"},{"dst":"192.168.1.0/24","dev":"eth0"}]"#;
    let def1 = r#"[{"dst":"0.0.0.0/1","dev":"tun0"},{"dst":"128.0.0.0/1","dev":"tun0"}]"#;
    assert!(routes(default).unwrap().to_the_internet);
    assert!(routes(def1).unwrap().to_the_internet);
}

#[test]
fn a_host_whose_routes_all_go_to_dropped_networks_has_no_way_out() {
    // Only the LAN, a VPN's internal network and the host's own addresses;
    // the v6 default is unreachable, as a kernel lists it without one.
    let v4 = r#"[{"dst":"192.168.1.0/24","dev":"eth0"},{"dst":"10.8.0.0/24","dev":"tun0"},{"type":"local","dst":"192.168.1.5","dev":"eth0","table":"local"}]"#;
    let v6 = r#"[{"type":"unreachable","dst":"default","dev":"lo","metric":4294967295},{"dst":"fe80::/64","dev":"eth0"}]"#;
    let v4 = routes(v4).unwrap();
    let v6 = routes(v6).unwrap();
    assert!(!v4.to_the_internet);
    assert!(!v6.to_the_internet);
    assert_eq!(
        v4.destinations,
        [
            "192.168.1.0/24".parse::<IpNet>().unwrap(),
            "10.8.0.0/24".parse().unwrap(),
            "192.168.1.5/32".parse().unwrap(),
        ]
    );
}
