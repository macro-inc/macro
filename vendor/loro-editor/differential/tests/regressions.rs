//! Minimized divergences found by the differential run, kept as literal scripts.

use loro_editor_differential::{
    run, Config, MergeRegime, Op, Stats, TextEdit, TextTarget, Unit, Value,
};

/// Seed 1: a suppressed editor commit that writes nothing, between a net-empty
/// import (insert + its undo, so upstream records no event) and a real import.
/// Upstream keeps the unreported range in the next event's DocDiff::from ([]);
/// resuming recording must not restart it at the current frontiers.
#[test]
fn empty_suppressed_commit_keeps_next_event_start_version() {
    let config = Config {
        merge: MergeRegime::InjectedAlways,
        max_undo: None,
    };
    let ops = [
        Op::Text {
            peer: 0,
            target: TextTarget::Root,
            edit: TextEdit::Insert {
                pos: 3_690_718_944,
                s: 4,
                unit: Unit::Utf16,
            },
        },
        Op::Text {
            peer: 2,
            target: TextTarget::Root,
            edit: TextEdit::Insert {
                pos: 2_201_577_751,
                s: 0,
                unit: Unit::Utf16,
            },
        },
        Op::Undo { peer: 2 },
        Op::Sync { from: 2, to: 1 },
        Op::CommitEditor { peer: 1 },
        Op::Sync { from: 0, to: 1 },
    ];
    let divergence = run(&config, &ops, &mut Stats::default());
    assert!(divergence.is_none(), "{}", divergence.unwrap());
}

/// Bulk seed 1: a shallow-reloaded document whose bulk tail passes the
/// forward-replay gate, exported at a frontier between the cached root and a
/// later insert that splits earlier text. Upstream's reverse checkout encodes
/// the root text in two fragments, the cached-prefix replay in one span: the
/// bytes differ (accepted, see ../README.md), the decoded snapshot must not.
#[test]
fn cached_prefix_export_decodes_like_reverse_checkout() {
    let config = Config {
        merge: MergeRegime::InjectedAlways,
        max_undo: None,
    };
    let ops = [
        Op::TreeCreate {
            peer: 0,
            parent: 11_354,
            index: 39_777,
        },
        Op::Reshallow {
            peer: 0,
            at: 56_615,
        },
        Op::Text {
            peer: 0,
            target: TextTarget::Root,
            edit: TextEdit::Insert {
                pos: 1_335_895_039,
                s: 5,
                unit: Unit::Unicode,
            },
        },
        Op::Text {
            peer: 0,
            target: TextTarget::Root,
            edit: TextEdit::Insert {
                pos: 1_577_098_070,
                s: 4,
                unit: Unit::Utf16,
            },
        },
        Op::Bulk { peer: 0 },
    ];
    let mut stats = Stats::default();
    let divergence = run(&config, &ops, &mut stats);
    assert!(divergence.is_none(), "{}", divergence.unwrap());
    assert_eq!(stats.cached_prefix_byte_diffs, 1, "{stats:?}");
}

macro_rules! fragmented_root_export {
    ($li:ident) => {{
        use li::cursor::PosType;
        use li::encoding::ExportMode;
        use $li as li;
        let seed = li::LoroDoc::new_auto_commit();
        seed.set_peer_id(1).unwrap();
        seed.get_tree("tr")
            .create_at(li::TreeParentId::Root, 0)
            .unwrap();
        seed.commit_then_renew();
        let shallow = seed
            .export(ExportMode::shallow_snapshot(&seed.oplog_frontiers()))
            .unwrap();
        let doc = li::LoroDoc::new_auto_commit();
        doc.set_peer_id(1).unwrap();
        doc.import(&shallow).unwrap();
        let text = doc.get_text("t");
        text.insert(0, "abc", PosType::Unicode).unwrap();
        let base = doc.oplog_frontiers();
        text.insert(2, "—“q”", PosType::Utf16).unwrap();
        doc.commit_then_renew();
        let tail: String = "ab😀\n".chars().cycle().take(70_000).collect();
        doc.get_text("bulk")
            .insert(0, &tail, PosType::Unicode)
            .unwrap();
        doc.commit_then_renew();
        let bytes = doc.export(ExportMode::shallow_snapshot(&base)).unwrap();
        let decoded = li::LoroDoc::new();
        decoded.import(&bytes).unwrap();
        let root = decoded.shallow_since_frontiers();
        let latest = format!("{:?}", decoded.get_deep_value_with_id());
        decoded.checkout(&root).unwrap();
        let at_root = format!("{:?}", decoded.get_deep_value_with_id());
        (bytes.len(), format!("{root:?}"), latest, at_root)
    }};
}

/// The same shape on the public API: decoded state equal, encoding 6 bytes
/// shorter on the patched side because its root text is one span.
#[test]
fn cached_prefix_export_bytes_differ_only_in_text_fragmentation() {
    let patched = fragmented_root_export!(loro_patched);
    let upstream = fragmented_root_export!(loro_upstream);
    assert_eq!(patched.1, upstream.1, "shallow root");
    assert_eq!(patched.2, upstream.2, "latest state");
    assert_eq!(patched.3, upstream.3, "state at the shallow root");
    assert_eq!((patched.0, upstream.0), (1648, 1654), "byte lengths");
}

/// Random seed 8: a suppressed editor commit that does write a change, on a
/// peer freshly reloaded from a shallow snapshot, followed by an import.
/// Upstream converts the commit's event, so the import's event starts at the
/// committed version; resuming must not keep the pre-commit start.
#[test]
fn suppressed_commit_moves_next_event_start_version() {
    let config = Config {
        merge: MergeRegime::InjectedAlways,
        max_undo: None,
    };
    let ops = [
        Op::AdoptShallow {
            peer: 2,
            from: 0,
            at: 1_416,
        },
        Op::ListInsert {
            peer: 2,
            pos: 53_598,
            value: Value::B(false),
        },
        Op::ListText {
            peer: 0,
            pos: 37_301,
        },
        Op::CommitEditor { peer: 2 },
        Op::Sync { from: 0, to: 2 },
    ];
    let divergence = run(&config, &ops, &mut Stats::default());
    assert!(divergence.is_none(), "{}", divergence.unwrap());
}
