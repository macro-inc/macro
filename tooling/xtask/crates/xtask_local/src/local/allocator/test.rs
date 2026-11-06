use std::collections::{BTreeMap, BTreeSet};

use super::*;

const ALL_BINDABLE: fn(u16) -> bool = |_| true;

fn ports<'a>(
    claimed: &'a BTreeMap<String, u16>,
    others: &'a BTreeSet<u16>,
    own: &'a BTreeSet<u16>,
    bindable: &'a dyn Fn(u16) -> bool,
) -> PortUse<'a> {
    PortUse {
        claimed,
        published_by_others: others,
        published_by_self: own,
        bindable,
    }
}

fn hashed_base(name: &str) -> u16 {
    Instance::derive(Some(name), None).unwrap().port_base()
}

#[test]
fn a_free_machine_gives_the_hashed_window() {
    let (claimed, others, own) = (BTreeMap::new(), BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(
        choose_window("agent-a", None, &use_),
        Some(hashed_base("agent-a"))
    );
}

/// The real collision behind `Bind for 0.0.0.0:30401 failed`: both names hash to
/// the same bucket.
#[test]
fn names_hashing_to_one_bucket_get_different_windows() {
    assert_eq!(hashed_base("crmgp"), hashed_base("synoet-routines-vis"));

    let claimed = BTreeMap::from([("synoet-routines-vis".to_string(), 30_400)]);
    let (others, own) = (BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(choose_window("crmgp", None, &use_), Some(30_500));
}

#[test]
fn a_hand_picked_base_off_the_stride_still_blocks_the_bucket_it_overlaps() {
    let claimed = BTreeMap::from([("handpicked".to_string(), 30_440)]);
    let (others, own) = (BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(
        use_.blocker(30_400),
        Some(WindowBlocker::Instance("handpicked".to_string()))
    );
    assert_eq!(use_.blocker(30_500), None);
}

#[test]
fn a_window_with_a_listening_port_is_skipped() {
    let busy_port = 30_400 + Port::Proxy.offset();
    let bindable = move |port: u16| port != busy_port;
    let (claimed, others, own) = (BTreeMap::new(), BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &bindable);

    assert_eq!(use_.blocker(30_400), Some(WindowBlocker::Port(busy_port)));
    assert_eq!(choose_window("crmgp", None, &use_), Some(30_500));
}

/// The stack never binds a retired port, so whatever listens there doesn't
/// block the window: `doctor-local` reports it free too.
#[test]
fn a_listener_on_a_retired_port_does_not_block_a_window() {
    let retired = 30_400 + Port::AgentProxy.offset();
    let bindable = move |port: u16| port != retired;
    let (claimed, others, own) = (BTreeMap::new(), BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &bindable);

    assert_eq!(use_.blocker(30_400), None);
}

#[test]
fn a_port_another_container_publishes_blocks_without_a_listening_socket() {
    let claimed = BTreeMap::new();
    let others = BTreeSet::from([30_403]);
    let own = BTreeSet::new();
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(use_.blocker(30_400), Some(WindowBlocker::Port(30_403)));
}

/// Adopting the allocator must not move an existing instance, even off the
/// stride or outside the bucket range.
#[test]
fn an_instance_keeps_the_window_its_own_containers_hold() {
    let own: BTreeSet<u16> = Port::all().map(|port| 41_600 + port.offset()).collect();
    let bindable = |port: u16| !(41_600..41_650).contains(&port);
    let (claimed, others) = (BTreeMap::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &bindable);

    assert_eq!(choose_window("crmgp", Some(41_600), &use_), Some(41_600));
}

#[test]
fn a_held_window_blocked_by_someone_else_moves() {
    let claimed = BTreeMap::from([("other".to_string(), 41_600)]);
    let (others, own) = (BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(
        choose_window("crmgp", Some(41_600), &use_),
        Some(hashed_base("crmgp"))
    );
}

#[test]
fn every_window_taken_gives_none() {
    let claimed: BTreeMap<String, u16> = (0..BUCKETS)
        .map(|bucket| {
            (
                format!("i{bucket}"),
                (WINDOW_START + bucket * STRIDE) as u16,
            )
        })
        .collect();
    let (others, own) = (BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(choose_window("agent-a", None, &use_), None);
}

#[test]
fn every_window_fits_every_offset_below_the_reserved_width() {
    let highest = Port::all().map(Port::offset).max().unwrap();

    assert!(highest < WINDOW_WIDTH);
    assert!(u32::from(WINDOW_WIDTH) <= STRIDE);
}

#[test]
fn a_block_with_any_live_network_is_skipped() {
    let hashed = choose_block("agent-a", None, &[], &BTreeSet::new()).unwrap();
    let one_old_patch_network = Ipv4Range::parse(&format!("10.254.{hashed}.192/26")).unwrap();

    let moved = choose_block("agent-a", None, &[one_old_patch_network], &BTreeSet::new()).unwrap();

    assert_eq!(moved, hashed.wrapping_add(1));
}

#[test]
fn a_block_reserved_by_a_start_still_building_is_skipped() {
    let hashed = choose_block("agent-a", None, &[], &BTreeSet::new()).unwrap();

    let moved = choose_block("agent-a", None, &[], &BTreeSet::from([hashed])).unwrap();

    assert_eq!(moved, hashed.wrapping_add(1));
}

#[test]
fn a_wide_range_covering_the_pool_leaves_no_block() {
    let route = Ipv4Range::parse("10.0.0.0/8").unwrap();

    assert_eq!(
        choose_block("agent-a", None, &[route], &BTreeSet::new()),
        None
    );
}

#[test]
fn an_existing_block_is_kept() {
    assert_eq!(
        choose_block("agent-a", Some(7), &[], &BTreeSet::new()),
        Some(7)
    );
}

#[test]
fn networks_are_carved_from_the_block_in_order() {
    let instance = Instance::derive(Some("agent-a"), None)
        .unwrap()
        .with_allocation(30_400, Some(9));

    assert_eq!(
        instance.networks(),
        vec![
            (
                "databases-agent-a".to_string(),
                Some("10.254.9.0/26".to_string())
            ),
            (
                "auth-agent-a".to_string(),
                Some("10.254.9.64/26".to_string())
            ),
            (
                "macro-agent-a_services".to_string(),
                Some("10.254.9.128/26".to_string())
            ),
            (
                "macro-agent-a_auth-internal".to_string(),
                Some("10.254.9.192/26".to_string())
            ),
        ]
    );
}

#[test]
fn the_default_instance_creates_only_its_two_shared_networks() {
    let instance = Instance::derive(None, None).unwrap();
    let names: Vec<String> = instance
        .networks()
        .into_iter()
        .map(|(name, _)| name)
        .collect();

    assert_eq!(names, ["databases", "auth"]);
}

#[test]
fn routes_parse_from_the_kernel_table_without_the_default_route() {
    let table = "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n\
                 ens3\t00000000\t01008E0A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n\
                 tun0\t00C8FE0A\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n";

    assert_eq!(
        parse_routes(table),
        vec![Ipv4Range::parse("10.254.200.0/24").unwrap()]
    );
}

#[test]
fn networks_map_back_to_their_instance() {
    assert_eq!(instance_of_network("databases-crmgp"), Some("crmgp"));
    assert_eq!(instance_of_network("auth-crmgp"), Some("crmgp"));
    assert_eq!(instance_of_network("macro-crmgp_services"), Some("crmgp"));
    assert_eq!(
        instance_of_network("macro-crmgp_auth-internal"),
        Some("crmgp")
    );
    assert_eq!(instance_of_network("databases"), None);
    assert_eq!(instance_of_network("macro_services"), None);
    assert_eq!(instance_of_network("macro_auth-internal"), None);
    assert_eq!(instance_of_network("bridge"), None);
}

#[test]
fn the_census_sorts_instances_by_what_they_hold() {
    let container = |project: &str, running: bool| docker::MachineContainer {
        id: String::new(),
        project: Some(project.to_string()),
        service: None,
        running,
        published: Vec::new(),
    };
    let network = |name: &str| docker::NetworkSubnets {
        name: name.to_string(),
        subnets: Vec::new(),
    };
    let machine = Machine {
        networks: vec![
            network("databases-up"),
            network("databases-old"),
            network("auth-old"),
            network("macro_services"),
        ],
        containers: vec![
            container("macro-up", true),
            container("macro-up", false),
            container("macro-down", false),
            container("macro", true),
        ],
    };

    assert_eq!(
        Census::from_machine(&machine),
        Census {
            running: vec!["up".to_string()],
            stopped: vec!["down".to_string()],
            networks_only: vec!["old".to_string()],
        }
    );
}

/// The lock is what makes a cold parallel start safe: without it, every process
/// reads the same empty registry and picks the same window.
#[test]
fn parallel_reservations_under_the_lock_get_distinct_windows() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_path_buf();
    let starts: Vec<_> = (0..16)
        .map(|_| {
            let path = path.clone();
            std::thread::spawn(move || {
                let _lock = lock(&path).unwrap();
                let mut registry = read_registry(&path);
                let claimed: BTreeMap<String, u16> = registry
                    .iter()
                    .map(|(name, allocation)| (name.clone(), allocation.port_base))
                    .collect();
                let (others, own) = (BTreeSet::new(), BTreeSet::new());
                let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);
                // One name, so every start begins on the same bucket.
                let port_base = choose_window("same-name", None, &use_).unwrap();
                let name = format!("start-{}", registry.len());
                registry.insert(
                    name,
                    Allocation {
                        port_base,
                        subnet_block: 0,
                        owner_pid: 1,
                    },
                );
                write_registry(&path, &registry).unwrap();
                port_base
            })
        })
        .collect();

    let bases: BTreeSet<u16> = starts
        .into_iter()
        .map(|start| start.join().unwrap())
        .collect();

    assert_eq!(bases.len(), 16);
}

#[test]
fn an_unreadable_registry_is_empty_rather_than_blocking_every_start() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(REGISTRY_FILE), "not json").unwrap();

    assert!(read_registry(dir.path()).is_empty());
}

#[test]
fn only_a_dead_owner_is_reported_gone() {
    assert!(process_alive(std::process::id()));
    assert!(!process_alive(i32::MAX as u32));
}

/// Each Docker bridge adds a host route for its subnet. Counting an instance's
/// own bridge routes as taken moved every restarted instance off its block.
#[test]
fn an_instance_keeps_its_block_despite_its_own_bridge_routes() {
    let instance = Instance::derive(Some("agent-a"), None).unwrap();
    let network = |name: &str, cidr: &str| docker::NetworkSubnets {
        name: name.to_string(),
        subnets: vec![cidr.to_string()],
    };
    let machine = Machine {
        networks: vec![
            network("databases-agent-a", "10.254.175.0/26"),
            network("macro-agent-a_auth-internal", "10.254.175.192/26"),
            network("databases-agent-b", "10.254.176.0/26"),
        ],
        containers: Vec::new(),
    };
    // Kernel routes for those three bridges, plus a VPN route.
    let routes = parse_routes(
        "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\n\
         br-1\t00AFFE0A\t00000000\t0001\t0\t0\t0\tC0FFFFFF\n\
         br-2\tC0AFFE0A\t00000000\t0001\t0\t0\t0\tC0FFFFFF\n\
         br-3\t00B0FE0A\t00000000\t0001\t0\t0\t0\tC0FFFFFF\n\
         tun0\t0000FE0A\t00000000\t0001\t0\t0\t0\t00FFFFFF\n",
    );

    let used = machine.used_subnets(&instance, routes);

    assert_eq!(
        choose_block("agent-a", Some(175), &used, &BTreeSet::new()),
        Some(175)
    );
    assert!(used.contains(&Ipv4Range::parse("10.254.176.0/26").unwrap()));
    assert!(used.contains(&Ipv4Range::parse("10.254.0.0/24").unwrap()));
}
