use std::collections::{BTreeMap, BTreeSet};

use super::*;
use crate::layout::{BUCKETS, STRIDE, WINDOW_START, hashed_window};

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

#[test]
fn a_free_machine_gives_the_hashed_window() {
    let (claimed, others, own) = (BTreeMap::new(), BTreeSet::new(), BTreeSet::new());
    let use_ = ports(&claimed, &others, &own, &ALL_BINDABLE);

    assert_eq!(
        choose_window("agent-a", None, &use_),
        Some(hashed_window("agent-a"))
    );
}

/// The real collision behind `Bind for 0.0.0.0:30401 failed`: both names hash to
/// the same bucket.
#[test]
fn names_hashing_to_one_bucket_get_different_windows() {
    assert_eq!(hashed_window("crmgp"), hashed_window("synoet-routines-vis"));

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
        Some(hashed_window("crmgp"))
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
