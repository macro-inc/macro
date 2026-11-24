use super::*;

fn state(seq: i64, removed: bool) -> ChannelEntryState {
    ChannelEntryState {
        channel_id: "c1".into(),
        seq,
        removed,
    }
}

#[test]
fn a_write_takes_effect_only_where_it_is_as_new_as_what_is_known() {
    for (held, stamp, watermark, admitted) in [
        // Held content gives way to content as new.
        (Some(state(5, false)), Some(5), Some(9), true),
        (Some(state(5, false)), Some(4), Some(1), false),
        (Some(state(5, false)), None, None, false),
        // A removed entry comes back only with content as new as its removal.
        (Some(state(5, true)), Some(5), None, true),
        (Some(state(5, true)), Some(4), None, false),
        (Some(state(5, true)), None, None, false),
        // An entry not held is known not to exist as of the watermark.
        (None, Some(9), Some(9), true),
        (None, Some(8), Some(9), false),
        (None, Some(8), None, true),
        (None, None, Some(9), true),
    ] {
        assert_eq!(
            admits(held.as_ref(), stamp, watermark),
            admitted,
            "{held:?} {stamp:?} {watermark:?}"
        );
    }
}

#[test]
fn the_watermark_never_skips_a_change() {
    use ChannelCommitStatus::{Applied, Gap, Stale, Unheld};
    use ParsedWatermark::{Advance, Keep, Lower, Reset};
    let advance = |from, to| Advance { from, to };
    for (commit, held, after) in [
        // A page read at an older sequence pulls the whole channel back to it.
        (Lower(7), None, (Some(7), Applied)),
        (Lower(7), Some(9), (Some(7), Applied)),
        (Lower(7), Some(5), (Some(5), Applied)),
        (advance(7, 8), Some(7), (Some(8), Applied)),
        (advance(5, 8), Some(7), (Some(8), Applied)),
        (advance(7, 8), Some(6), (Some(6), Gap)),
        (advance(7, 8), Some(8), (Some(8), Stale)),
        (advance(7, 8), Some(9), (Some(9), Stale)),
        (advance(7, 8), None, (None, Unheld)),
        (Reset(12), Some(30), (Some(12), Applied)),
        (Keep, Some(3), (Some(3), Applied)),
        (Keep, None, (None, Applied)),
    ] {
        assert_eq!(commit.apply(held), after, "{commit:?} over {held:?}");
    }
}

#[test]
fn coverage_joins_what_is_held_unless_the_commit_drops_it() {
    let span = |start: &str, end: &str| TimelineSpan {
        start: start.into(),
        end: end.into(),
    };
    let channel = TimelineScope::Channel("c1".into());
    let thread = TimelineScope::Thread("m1".into());
    let guard = ChannelGuard {
        coverage: [
            (("c1".to_owned(), channel.clone()), vec![span("30", "40")]),
            (("c1".to_owned(), thread.clone()), vec![span("1", "9")]),
        ]
        .into(),
        ..ChannelGuard::default()
    };
    let covering = |thread: Option<&str>, start: &str, end: &str| super::super::ChannelCoverage {
        thread_root_id: thread.map(Into::into),
        span: span(start, end),
    };
    let commit = ChannelTimelineCommit {
        channel_id: "c1".into(),
        coverage: vec![covering(None, "20", "30"), covering(Some("m1"), "3", "4")],
        ..ChannelTimelineCommit::default()
    };
    let written = |commit: &ChannelTimelineCommit| {
        coverage_writes(commit, &guard)
            .into_iter()
            .map(|write| (write.scope, write.spans))
            .collect::<Vec<_>>()
    };
    // The thread already covers its stretch.
    assert_eq!(
        written(&commit),
        [(channel.clone(), vec![span("20", "40")])]
    );
    assert_eq!(
        written(&ChannelTimelineCommit {
            dropped_thread_root_ids: vec!["m1".into(), "m2".into()],
            ..commit.clone()
        }),
        [
            (channel.clone(), vec![span("20", "40")]),
            (thread.clone(), vec![span("3", "4")]),
            (TimelineScope::Thread("m2".into()), Vec::new()),
        ]
    );
    assert_eq!(
        written(&ChannelTimelineCommit {
            reset: true,
            ..commit
        }),
        [
            (channel, vec![span("20", "30")]),
            (thread, vec![span("3", "4")]),
        ]
    );
}
