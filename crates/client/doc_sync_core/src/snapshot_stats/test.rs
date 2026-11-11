use super::*;

#[test]
fn snapshot_counts_preserve_the_live_state_and_export() {
    let doc = LoroDoc::new();
    doc.set_peer_id(7).unwrap();
    doc.set_record_timestamp(false);
    let text = doc.get_text("text");
    text.insert(0, "base").unwrap();
    doc.commit();
    let base = doc.oplog_frontiers();
    text.insert(4, "tail").unwrap();
    doc.commit();
    let before = doc.export(loro::ExportMode::snapshot()).unwrap();
    let vv = doc.oplog_vv();
    assert_eq!(
        SnapshotStats::from_doc(&doc, &base),
        SnapshotStats {
            base_ops: Some(4),
            current_ops: 8,
            retained_ops: Some(4),
            cached_root_ops: 0,
            base_cached_root_distance: Some(4),
        }
    );
    assert_eq!(doc.oplog_vv(), vv);
    assert_eq!(doc.export(loro::ExportMode::snapshot()).unwrap(), before);
}

#[test]
fn shallow_root_distance_keeps_the_retained_frontier_operation() {
    let source = LoroDoc::new();
    source.set_peer_id(7).unwrap();
    source.get_text("text").insert(0, "base").unwrap();
    source.commit();
    let base = source.oplog_frontiers();
    source.get_text("text").insert(4, "tail").unwrap();
    source.commit();
    let bytes = source
        .export(loro::ExportMode::shallow_snapshot(&base))
        .unwrap();
    let doc = LoroDoc::new();
    doc.import(&bytes).unwrap();
    assert_eq!(
        SnapshotStats::from_doc(&doc, &base),
        SnapshotStats {
            base_ops: Some(4),
            current_ops: 8,
            retained_ops: Some(4),
            cached_root_ops: 3,
            base_cached_root_distance: Some(1),
        }
    );
}

#[test]
fn unknown_base_is_unmeasured_instead_of_zero() {
    let doc = LoroDoc::new();
    doc.set_peer_id(7).unwrap();
    doc.get_text("text").insert(0, "base").unwrap();
    doc.commit();
    let unknown = Frontiers::from(loro::ID::new(99, 7));
    let stats = SnapshotStats::from_doc(&doc, &unknown);
    assert_eq!(stats.base_ops, None);
    assert_eq!(stats.retained_ops, None);
    assert_eq!(stats.base_cached_root_distance, None);
    assert_eq!(stats.current_ops, 4);
}
