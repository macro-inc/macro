use std::net::Ipv4Addr;

use super::Network;
use crate::config::{ControlPlaneAccess, GuestDestination, NetworkConfig};

fn network(control_plane: Option<ControlPlaneAccess>) -> Network {
    Network::new(
        NetworkConfig {
            slots: 64,
            prefix: "fch".to_owned(),
            veth_base: Ipv4Addr::new(10, 201, 0, 0),
            dns: vec!["1.1.1.1".to_owned()],
            uplink: "ens4".to_owned(),
            api_sources: vec![Ipv4Addr::new(35, 171, 97, 195)],
            control_plane,
            guest_destinations: vec![GuestDestination {
                address: Ipv4Addr::new(10, 150, 0, 19),
                port: 18080,
            }],
        },
        8444,
        100_000_000,
    )
}

#[test]
fn slots_get_disjoint_veth_pairs() {
    let network = network(None);
    assert_eq!(
        network.veth_addresses(0),
        (Ipv4Addr::new(10, 201, 0, 1), Ipv4Addr::new(10, 201, 0, 2))
    );
    assert_eq!(
        network.veth_addresses(64),
        (Ipv4Addr::new(10, 201, 1, 1), Ipv4Addr::new(10, 201, 1, 2))
    );
}

#[test]
fn the_tailnet_control_plane_is_the_only_tailnet_destination() {
    let tables = network(Some(ControlPlaneAccess {
        address: Ipv4Addr::new(100, 90, 1, 2),
        ports: vec![8080, 8443],
    }))
    .root_tables();

    let accept = tables
        .find("oifname \"tailscale0\" ip daddr 100.90.1.2 tcp dport { 8080, 8443 } accept")
        .unwrap();
    let drop = tables.find("oifname { \"tailscale0\"").unwrap();
    assert!(accept < drop);
    assert!(tables.contains("ip saddr { 35.171.97.195 } accept"));
}

#[test]
fn without_a_control_plane_no_tailnet_traffic_is_accepted() {
    let tables = network(None).root_tables();
    assert!(!tables.contains("daddr 100."));
}

#[test]
fn the_hosts_own_traffic_is_never_filtered() {
    // A host-wide output rule once dropped the host's DNS to
    // 169.254.169.254:53, and with it every Incus guest's on a shared host.
    let tables = network(None).root_tables();
    assert!(!tables.contains("hook output"));
    assert!(!tables.contains("skuid"));
}

#[test]
fn a_guest_destination_is_one_address_and_port_ahead_of_the_private_drop() {
    let tables = network(None).root_tables();
    let accept = tables
        .find("ip daddr 10.150.0.19 tcp dport 18080 accept")
        .unwrap();
    let drop = tables.find("ip daddr @blocked_ipv4 counter drop").unwrap();
    assert!(accept < drop);
}
