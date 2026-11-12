use std::collections::BTreeSet;

use super::*;

#[test]
fn port_offsets_are_unique() {
    let mut seen = BTreeSet::new();
    for port in Port::all() {
        assert!(seen.insert(port.offset()), "duplicate offset for {port:?}");
    }
}

#[test]
fn every_window_fits_every_offset_below_the_reserved_width() {
    let highest = Port::all().map(Port::offset).max().unwrap();

    assert!(highest < WINDOW_WIDTH);
    assert!(u32::from(WINDOW_WIDTH) <= STRIDE);
}

#[test]
fn every_window_stays_below_the_linux_ephemeral_range() {
    let highest_base = WINDOW_START + (BUCKETS - 1) * STRIDE;

    assert!(highest_base + u32::from(WINDOW_WIDTH) <= 32_768);
}

/// New `Port` variants must be appended. Inserting mid-enum shifts named-instance
/// offsets for every later variant (Kafka, webhooks, agent harness, …).
#[test]
fn appended_port_offsets_stay_stable() {
    assert_eq!(Port::Kafka.offset(), 22);
    assert_eq!(Port::SdkWebhookSsh.offset(), 23);
    assert_eq!(Port::SdkWebhookHostReceiver.offset(), 24);
    assert_eq!(Port::AgentProxy.offset(), 25);
    assert_eq!(Port::AgentHarness.offset(), 26);
    assert_eq!(Port::AgentHarnessEgress.offset(), 27);
    assert_eq!(Port::ScheduledAction.offset(), 28);
    assert_eq!(Port::ScheduledAction.fixed(), 8099);
    assert_eq!(Port::DocCognition.offset(), 14);
    assert_eq!(Port::OpenBao.offset(), 33);
    assert_eq!(Port::OpenBao.fixed(), 8200);
}

#[test]
fn a_name_hashes_to_a_stable_window_on_the_stride() {
    // Pinned values: changing the hash moves every existing instance.
    assert_eq!(hashed_window("crmgp"), 30_400);
    assert_eq!(hashed_window("synoet-routines-vis"), 30_400);
    let base = u32::from(hashed_window("agent-a"));
    assert_eq!((base - WINDOW_START) % STRIDE, 0);
    assert!(base < WINDOW_START + BUCKETS * STRIDE);
}

#[test]
fn the_window_search_starts_at_the_hash_and_visits_every_window_once() {
    let order: Vec<u16> = windows_from("crmgp").collect();

    assert_eq!(order[0], hashed_window("crmgp"));
    assert_eq!(order[1], 30_500);
    assert_eq!(order.len(), BUCKETS as usize);
    assert_eq!(order.iter().collect::<BTreeSet<_>>().len(), order.len());
}

#[test]
fn the_window_search_wraps_from_the_last_window_to_the_first() {
    let last = (WINDOW_START + (BUCKETS - 1) * STRIDE) as u16;
    let order: Vec<u16> = windows_from("agent-a").collect();
    let at_last = order.iter().position(|base| *base == last).unwrap();

    assert_eq!(order[(at_last + 1) % order.len()], WINDOW_START as u16);
}

#[test]
fn the_block_search_visits_every_block_once() {
    let order: Vec<u8> = blocks_from("agent-a").collect();

    assert_eq!(order.len(), 256);
    assert_eq!(order.iter().collect::<BTreeSet<_>>().len(), 256);
}

#[test]
fn windows_overlap_within_the_reserved_width() {
    assert!(windows_overlap(30_400, 30_440));
    assert!(windows_overlap(30_440, 30_400));
    assert!(!windows_overlap(30_400, 30_450));
    assert!(!windows_overlap(30_400, 30_500));
}

#[test]
fn networks_are_carved_from_the_block_in_order() {
    let subnets: Vec<String> = (0..4).map(|index| network_subnet(9, index)).collect();

    assert_eq!(
        subnets,
        [
            "10.254.9.0/26",
            "10.254.9.64/26",
            "10.254.9.128/26",
            "10.254.9.192/26"
        ]
    );
}
