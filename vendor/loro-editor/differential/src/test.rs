use super::*;

/// Patched and upstream observations of one peer that differ only in the bytes
/// of one export, both decoding to the same state.
fn byte_only_difference(peer: usize, export: &str, eligible: bool) -> (Observation, Observation) {
    let patched = Observation {
        peer,
        outcome: Some("ok".into()),
        value: "{}".into(),
        value_with_id: "{}".into(),
        oplog_vv: vec![(1, 4)],
        state_vv: vec![(1, 4)],
        oplog_frontiers: vec![(1, 3)],
        state_frontiers: vec![(1, 3)],
        shallow_since: vec![(1, 0)],
        detached: false,
        undo: (0, 0, false, false),
        events: vec![],
        event_from: vec![],
        event_to: vec![],
        undo_log: vec![],
        exports: vec![(export.into(), Ok(vec![1, 2, 3]))],
        shallow: vec![(export.into(), eligible, "root=[(1, 0)] latest={}".into())],
        adopted: None,
        suppressed: false,
    };
    let mut upstream = patched.clone();
    upstream.exports = vec![(export.into(), Ok(vec![1, 2, 3, 4]))];
    (patched, upstream)
}

#[test]
fn fragmented_lineage_does_not_excuse_another_peers_snapshot_bytes() {
    let (patched, upstream) = byte_only_difference(1, "snapshot", false);
    let mut fragmented = [true, false, false];
    let divergence = compare(
        7,
        &patched,
        &upstream,
        &mut Stats::default(),
        &mut fragmented,
    );
    assert_eq!(
        divergence.map(|d| d.field),
        Some("peer1.export[snapshot | snapshot]".into())
    );
}

#[test]
fn fragmented_lineage_excuses_its_own_snapshot_bytes() {
    let (patched, upstream) = byte_only_difference(0, "snapshot", false);
    let mut fragmented = [true, false, false];
    let mut stats = Stats::default();
    assert!(compare(7, &patched, &upstream, &mut stats, &mut fragmented).is_none());
    assert_eq!(stats.inherited_byte_diffs, 1);
}

#[test]
fn fragmented_lineage_never_excuses_update_bytes() {
    let (mut patched, mut upstream) = byte_only_difference(0, "all_updates", false);
    patched.shallow.clear();
    upstream.shallow.clear();
    let mut fragmented = [true, false, false];
    let divergence = compare(
        7,
        &patched,
        &upstream,
        &mut Stats::default(),
        &mut fragmented,
    );
    assert_eq!(
        divergence.map(|d| d.field),
        Some("peer0.export[all_updates | all_updates]".into())
    );
}

#[test]
fn eligible_export_bytes_are_excused_without_tainting_the_exporter() {
    let (patched, upstream) = byte_only_difference(2, "shallow@h1", true);
    let mut fragmented = [false; PEERS];
    let mut stats = Stats::default();
    assert!(compare(7, &patched, &upstream, &mut stats, &mut fragmented).is_none());
    assert_eq!(stats.cached_prefix_byte_diffs, 1);
    assert_eq!(fragmented, [false; PEERS]);
}

#[test]
fn adopting_differing_bytes_needs_an_eligible_or_fragmented_source() {
    let (mut patched, mut upstream) = byte_only_difference(1, "snapshot", false);
    patched.exports.clear();
    upstream.exports.clear();
    patched.shallow.clear();
    upstream.shallow.clear();
    patched.adopted = Some(Adoption {
        from: 2,
        source_eligible: false,
        bytes: vec![1],
    });
    upstream.adopted = Some(Adoption {
        from: 2,
        source_eligible: false,
        bytes: vec![2],
    });

    let mut clean = [false; PEERS];
    let divergence = compare(7, &patched, &upstream, &mut Stats::default(), &mut clean);
    assert_eq!(
        divergence.map(|d| d.field),
        Some("peer1.adopted bytes from peer2".into())
    );

    let mut source_fragmented = [false, false, true];
    assert!(compare(
        7,
        &patched,
        &upstream,
        &mut Stats::default(),
        &mut source_fragmented
    )
    .is_none());
    assert_eq!(source_fragmented, [false, true, true]);
}

#[test]
fn adopting_identical_bytes_clears_the_lineage() {
    let (mut patched, mut upstream) = byte_only_difference(1, "snapshot", false);
    patched.exports.clear();
    upstream.exports.clear();
    patched.shallow.clear();
    upstream.shallow.clear();
    patched.adopted = Some(Adoption {
        from: 1,
        source_eligible: false,
        bytes: vec![1],
    });
    upstream.adopted = patched.adopted.clone();
    let mut fragmented = [false, true, false];
    assert!(compare(
        7,
        &patched,
        &upstream,
        &mut Stats::default(),
        &mut fragmented
    )
    .is_none());
    assert_eq!(fragmented, [false; PEERS]);
}
