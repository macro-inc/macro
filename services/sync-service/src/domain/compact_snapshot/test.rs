use loro::{ExportMode, LoroDoc};

use super::*;

const DOCUMENT_ID: &str = "test-document";

fn peer(id: u64) -> LoroDoc {
    let doc = LoroDoc::new();
    doc.set_peer_id(id).unwrap();
    doc
}

fn edit(doc: &LoroDoc, step: usize) {
    doc.get_text("content")
        .insert(0, &format!("{step} "))
        .unwrap();
    doc.commit();
}

fn sync(from: &LoroDoc, to: &LoroDoc) {
    to.import(&from.export(ExportMode::updates(&to.oplog_vv())).unwrap())
        .unwrap();
}

/// Overwrite one map value many times with text that does not compress, so a
/// full snapshot carries a few MiB of history the current state no longer
/// holds.
fn overwrite_large_values(doc: &LoroDoc) {
    let map = doc.get_map("attachments");
    let mut seed: u32 = 1;
    for _ in 0..20 {
        let value: String = (0..128 * 1024)
            .map(|_| {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                char::from(b'a' + u8::try_from((seed >> 16) % 26).unwrap())
            })
            .collect();
        map.insert("file", value).unwrap();
        doc.commit();
    }
}

/// Two peers that took turns editing `rounds` times, then each made one edit
/// the other has not seen: the shape of a document whose last two editors
/// left at the same time.
fn turns_then_concurrent_edits(rounds: usize) -> LoroDoc {
    take_turns_then_edit_concurrently(peer(1), rounds)
}

fn take_turns_then_edit_concurrently(left: LoroDoc, rounds: usize) -> LoroDoc {
    let right = peer(2);
    for round in 0..rounds {
        edit(&left, round);
        sync(&left, &right);
        edit(&right, round);
        sync(&right, &left);
    }
    edit(&left, rounds);
    edit(&right, rounds);
    sync(&right, &left);
    left
}

/// Fresh peers that each edit a document with a long shared history once.
fn concurrent_edits_on_shared_history(heads: u64) -> LoroDoc {
    let base = peer(100);
    for step in 0..2_000 {
        edit(&base, step);
    }
    branches_on(&base, heads, 1)
}

/// `heads` fresh peers that each make `edits` edits on `base` without seeing
/// each other's, merged into one document.
fn branches_on(base: &LoroDoc, heads: u64, edits: usize) -> LoroDoc {
    let snapshot = base.export(ExportMode::Snapshot).unwrap();
    let merged = LoroDoc::from_snapshot(&snapshot).unwrap();
    for id in 1..=heads {
        let branch = LoroDoc::from_snapshot(&snapshot).unwrap();
        branch.set_peer_id(id).unwrap();
        for step in 0..edits {
            edit(&branch, step);
        }
        sync(&branch, &merged);
    }
    merged
}

/// Peers that never saw each other's edits, so no single version precedes
/// both.
fn independent_histories(edits: usize) -> LoroDoc {
    let left = peer(1);
    let right = peer(2);
    for step in 0..edits {
        edit(&left, step);
        edit(&right, step);
    }
    sync(&right, &left);
    left
}

/// The history Loro's own shallow export of `doc` keeps.
fn loro_shallow_history(doc: &LoroDoc) -> u64 {
    let shallow = doc
        .export(ExportMode::shallow_snapshot_owned(doc.state_frontiers()))
        .unwrap();
    history_len(&LoroDoc::from_snapshot(&shallow).unwrap())
}

fn walk(doc: &LoroDoc, budget: u32) -> Search {
    retained_ops_above_root(doc, &doc.state_frontiers(), &doc.oplog_frontiers(), budget).unwrap()
}

fn assert_same_document(snapshot: &[u8], doc: &LoroDoc) -> LoroDoc {
    let restored = LoroDoc::from_snapshot(snapshot).unwrap();
    assert_eq!(restored.get_deep_value(), doc.get_deep_value());
    assert_eq!(restored.oplog_vv(), doc.oplog_vv());
    assert_eq!(restored.state_frontiers(), doc.state_frontiers());
    restored
}

#[test]
fn a_single_head_exports_a_shallow_snapshot_of_its_last_change() {
    let solo = peer(1);
    for step in 0..2_000 {
        edit(&solo, step);
    }
    let taken_turns = turns_then_concurrent_edits(600);
    edit(&taken_turns, 0);
    for doc in [solo, taken_turns] {
        assert_eq!(doc.oplog_frontiers().len(), 1);
        let (snapshot, choice) = export(&doc, DOCUMENT_ID).unwrap();
        assert_eq!(choice, CompactExport::Shallow { retained_ops: 0 });
        let restored = assert_same_document(&snapshot, &doc);
        assert!(restored.is_shallow());
        assert_eq!(history_len(&restored), 1);
    }
}

#[test]
fn concurrent_heads_over_turn_taking_history_export_a_full_snapshot() {
    let doc = turns_then_concurrent_edits(600);
    assert_eq!(doc.oplog_frontiers().len(), 2);
    // Only the two concurrent edits follow the last version both peers saw,
    // but Loro's shallow export keeps the history back to the first turn.
    assert!(loro_shallow_history(&doc) > u64::from(MAX_SHALLOW_RETAINED_OPS));
    assert_eq!(walk(&doc, MAX_SHALLOW_RETAINED_OPS), Search::OverBudget,);

    let (snapshot, choice) = export(&doc, DOCUMENT_ID).unwrap();
    assert_eq!(choice, CompactExport::Full);
    let restored = assert_same_document(&snapshot, &doc);
    assert!(!restored.is_shallow());
}

#[test]
fn concurrent_heads_on_shared_history_still_export_shallow() {
    for heads in [2, 3, 9] {
        let doc = concurrent_edits_on_shared_history(heads);
        let (snapshot, choice) = export(&doc, DOCUMENT_ID).unwrap();
        assert!(
            matches!(choice, CompactExport::Shallow { retained_ops } if retained_ops < 50),
            "{heads} heads: {choice:?}"
        );
        let restored = assert_same_document(&snapshot, &doc);
        assert!(restored.is_shallow());
    }
}

#[test]
fn the_walk_counts_the_history_loro_keeps() {
    let mut docs = vec![
        turns_then_concurrent_edits(1),
        turns_then_concurrent_edits(40),
        turns_then_concurrent_edits(600),
    ];
    docs.extend([2, 5].map(concurrent_edits_on_shared_history));
    for doc in docs {
        let Search::Root { retained_ops } = walk(&doc, u32::MAX) else {
            panic!("no root for {:?}", doc.oplog_frontiers());
        };
        assert_eq!(loro_shallow_history(&doc), u64::from(retained_ops) + 1);
        assert_eq!(walk(&doc, retained_ops), Search::Root { retained_ops });
        if retained_ops > 0 {
            assert_eq!(walk(&doc, retained_ops - 1), Search::OverBudget);
        }
    }
}

#[test]
fn independent_histories_export_shallow_only_while_small() {
    let small = independent_histories(3);
    assert_eq!(walk(&small, u32::MAX), Search::NoRoot);
    // Loro keeps all history when there is no single version to start from.
    assert_eq!(loro_shallow_history(&small), history_len(&small));
    let (snapshot, choice) = export(&small, DOCUMENT_ID).unwrap();
    assert_eq!(
        choice,
        CompactExport::Shallow {
            retained_ops: u32::try_from(history_len(&small)).unwrap()
        }
    );
    assert_same_document(&snapshot, &small);

    let large = independent_histories(1_000);
    let (snapshot, choice) = export(&large, DOCUMENT_ID).unwrap();
    assert_eq!(choice, CompactExport::Full);
    assert_same_document(&snapshot, &large);
}

#[test]
fn a_large_full_snapshot_gives_way_to_a_shallow_one_that_keeps_more_history() {
    let base = peer(100);
    overwrite_large_values(&base);
    let doc = branches_on(&base, 2, 300);
    assert!(doc.export(ExportMode::Snapshot).unwrap().len() > MAX_FULL_SNAPSHOT_BYTES);
    let Search::Root { retained_ops } = walk(&doc, u32::MAX) else {
        panic!("no root for {:?}", doc.oplog_frontiers());
    };
    assert!(retained_ops > MAX_SHALLOW_RETAINED_OPS);
    assert!(retained_ops <= MAX_SHALLOW_RETAINED_OPS_FOR_LARGE_DOCUMENTS);

    let (snapshot, choice) = export(&doc, DOCUMENT_ID).unwrap();
    assert_eq!(choice, CompactExport::Shallow { retained_ops });
    assert!(snapshot.len() < MAX_FULL_SNAPSHOT_BYTES);
    let restored = assert_same_document(&snapshot, &doc);
    assert!(restored.is_shallow());
}

#[test]
fn a_large_full_snapshot_stays_full_when_a_shallow_one_would_keep_too_much() {
    let left = peer(1);
    overwrite_large_values(&left);
    let doc = take_turns_then_edit_concurrently(left, 1_000);
    assert!(doc.export(ExportMode::Snapshot).unwrap().len() > MAX_FULL_SNAPSHOT_BYTES);
    assert_eq!(
        walk(&doc, MAX_SHALLOW_RETAINED_OPS_FOR_LARGE_DOCUMENTS),
        Search::OverBudget
    );

    let (snapshot, choice) = export(&doc, DOCUMENT_ID).unwrap();
    assert_eq!(choice, CompactExport::Full);
    let restored = assert_same_document(&snapshot, &doc);
    assert!(!restored.is_shallow());
}

#[test]
fn an_empty_document_has_no_root_and_exports_shallow() {
    let doc = LoroDoc::new();
    assert_eq!(walk(&doc, u32::MAX), Search::NoRoot);
    let (snapshot, choice) = export(&doc, DOCUMENT_ID).unwrap();
    assert_eq!(choice, CompactExport::Shallow { retained_ops: 0 });
    assert_same_document(&snapshot, &doc);
}
