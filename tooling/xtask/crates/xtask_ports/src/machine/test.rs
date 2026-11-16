use super::*;

fn container(owner: Option<&str>, running: bool, published: &[u16]) -> Container {
    Container {
        owner: owner.map(str::to_string),
        running,
        published: published.to_vec(),
    }
}

fn network(name: &str, owner: Option<&str>, cidr: &[&str]) -> Network {
    Network {
        name: name.to_string(),
        owner: owner.map(str::to_string),
        subnets: cidr
            .iter()
            .map(|cidr| Ipv4Range::parse(cidr).unwrap())
            .collect(),
    }
}

#[test]
fn the_census_sorts_instances_by_what_they_hold() {
    let machine = Machine {
        networks: vec![
            network("databases-up", Some("up"), &[]),
            network("databases-old", Some("old"), &[]),
            network("auth-old", Some("old"), &[]),
            network("macro_services", None, &[]),
        ],
        containers: vec![
            container(Some("up"), true, &[]),
            container(Some("up"), false, &[]),
            container(Some("down"), false, &[]),
            container(Some(DEFAULT_INSTANCE), true, &[]),
            container(None, true, &[]),
        ],
        ..Machine::default()
    };

    assert_eq!(
        machine.census(),
        Census {
            running: vec!["up".to_string()],
            stopped: vec!["down".to_string()],
            networks_only: vec!["old".to_string()],
        }
    );
}

#[test]
fn leftovers_are_named_and_a_clean_machine_has_none() {
    let census = Census {
        running: vec!["up".to_string()],
        stopped: Vec::new(),
        networks_only: vec!["old".to_string()],
    };

    assert_eq!(
        census.leftovers_message().unwrap(),
        "stopped: none; networks only: old. Check one is unused, then `just destroy_local \
         --instance <name>` frees it"
    );
    assert_eq!(Census::default().leftovers_message(), None);
}

#[test]
fn an_instance_is_held_by_its_containers_or_its_networks() {
    let machine = Machine {
        networks: vec![network("auth-old", Some("old"), &[])],
        containers: vec![
            container(Some("up"), true, &[]),
            container(Some(DEFAULT_INSTANCE), true, &[]),
        ],
        ..Machine::default()
    };

    assert!(machine.has_instance("up"));
    assert!(machine.has_instance("old"));
    assert!(!machine.has_instance("gone"));
    // The default instance holds fixed ports, not a reservation.
    assert!(!machine.has_instance(DEFAULT_INSTANCE));
}

/// Each Docker bridge adds a host route for its subnet. Counting an instance's
/// own bridge routes as taken moved every restarted instance off its block.
#[test]
fn an_instance_keeps_its_block_despite_its_own_bridge_routes() {
    let machine = Machine {
        networks: vec![
            network("databases-agent-a", Some("agent-a"), &["10.254.175.0/26"]),
            network(
                "macro-agent-a_auth-internal",
                Some("agent-a"),
                &["10.254.175.192/26"],
            ),
            network("databases-agent-b", Some("agent-b"), &["10.254.176.0/26"]),
        ],
        // Kernel routes for those three bridges, plus a VPN route.
        routes: crate::net::parse_routes(
            "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n\
             br-1\t00AFFE0A\t00000000\t0001\t0\t0\t0\tC0FFFFFF\n\
             br-2\tC0AFFE0A\t00000000\t0001\t0\t0\t0\tC0FFFFFF\n\
             br-3\t00B0FE0A\t00000000\t0001\t0\t0\t0\tC0FFFFFF\n\
             tun0\t0000FE0A\t00000000\t0001\t0\t0\t0\t00FFFFFF\n",
        ),
        ..Machine::default()
    };
    let own = BTreeSet::from([
        "databases-agent-a".to_string(),
        "auth-agent-a".to_string(),
        "macro-agent-a_services".to_string(),
        "macro-agent-a_auth-internal".to_string(),
    ]);

    let used = machine.used_subnets(&own);

    assert!(
        !used
            .iter()
            .any(|range| range.overlaps(crate::net::block_range(175)))
    );
    assert!(used.contains(&Ipv4Range::parse("10.254.176.0/26").unwrap()));
    assert!(used.contains(&Ipv4Range::parse("10.254.0.0/24").unwrap()));
}

#[test]
fn busy_ports_skip_the_instances_own_and_name_everything_else() {
    let machine = Machine {
        containers: vec![
            container(Some("agent-a"), true, &[30_400]),
            container(Some("agent-b"), true, &[30_401]),
        ],
        ..Machine::default()
    };
    let listening = |port: u16| port != 30_400 && port != 30_402;

    assert_eq!(
        machine.busy_ports("agent-a", [30_400, 30_401, 30_402, 30_403], listening),
        [30_401, 30_402]
    );
}
