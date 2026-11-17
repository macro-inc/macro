//! Minimized divergences found by the differential run, kept as literal scripts.

use loro_editor_differential::{run, Config, MergeRegime, Op, Stats, TextEdit, TextTarget, Unit};

/// Seed 1: a suppressed editor commit that writes nothing, between a net-empty
/// import (insert + its undo, so upstream records no event) and a real import.
/// Upstream keeps the unreported range in the next event's DocDiff::from ([]);
/// resuming recording must not restart it at the current frontiers.
#[test]
fn empty_suppressed_commit_keeps_next_event_start_version() {
    let config = Config { merge: MergeRegime::InjectedAlways, max_undo: None };
    let ops = [
        Op::Text {
            peer: 0,
            target: TextTarget::Root,
            edit: TextEdit::Insert { pos: 3_690_718_944, s: 4, unit: Unit::Utf16 },
        },
        Op::Text {
            peer: 2,
            target: TextTarget::Root,
            edit: TextEdit::Insert { pos: 2_201_577_751, s: 0, unit: Unit::Utf16 },
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
/// forward-replay gate. Exporting a shallow snapshot at a frontier between the
/// cached root and a later insert that splits earlier text: upstream's reverse
/// checkout encodes the root text in two fragments, the cached-prefix replay in
/// one span. Decoded state is identical; the bytes are not.
#[test]
#[ignore = "known divergence: cached-prefix shallow export bytes (awaiting ruling)"]
fn cached_prefix_export_matches_reverse_checkout_bytes() {
    let config = Config { merge: MergeRegime::InjectedAlways, max_undo: None };
    let ops = [
        Op::TreeCreate { peer: 0, parent: 11_354, index: 39_777 },
        Op::Reshallow { peer: 0, at: 56_615 },
        Op::Text {
            peer: 0,
            target: TextTarget::Root,
            edit: TextEdit::Insert { pos: 1_335_895_039, s: 5, unit: Unit::Unicode },
        },
        Op::Text {
            peer: 0,
            target: TextTarget::Root,
            edit: TextEdit::Insert { pos: 1_577_098_070, s: 4, unit: Unit::Utf16 },
        },
        Op::Bulk { peer: 0 },
    ];
    let divergence = run(&config, &ops, &mut Stats::default());
    assert!(divergence.is_none(), "{}", divergence.unwrap());
}
