use super::*;

fn span(start: &str, end: &str) -> TimelineSpan {
    TimelineSpan {
        start: start.into(),
        end: end.into(),
    }
}

fn coverage(thread: Option<&str>, start: &str, end: &str) -> ChannelCoverage {
    ChannelCoverage {
        thread_root_id: thread.map(Into::into),
        span: span(start, end),
    }
}

fn advance(from: &str) -> Option<ChannelWatermark> {
    Some(ChannelWatermark::Advance { from: from.into() })
}

#[test]
fn a_commit_names_the_sequence_everything_in_it_was_read_at() {
    use ChannelTimelineError::{InvalidCommit, InvalidKey, InvalidSeq, InvalidSpan, TooLarge};
    let commit = |edit: fn(&mut ChannelTimelineCommit)| {
        let mut commit = ChannelTimelineCommit {
            channel_id: "c1".into(),
            ..ChannelTimelineCommit::default()
        };
        edit(&mut commit);
        commit.validate()
    };
    assert_eq!(commit(|c| c.touched_at_ms = Some(1)), Ok(()));
    assert_eq!(
        commit(|c| c.dropped_thread_root_ids.push("m1".into())),
        Ok(())
    );
    assert_eq!(commit(|c| c.channel_id.clear()), Err(InvalidKey));
    assert_eq!(
        commit(|c| c.removed_ids.push(String::new())),
        Err(InvalidKey)
    );
    assert_eq!(commit(|c| c.removed_ids.push("m1".into())), Err(InvalidSeq));
    assert_eq!(
        commit(|c| {
            c.seq = Some("4".into());
            c.removed_ids.push("m1".into());
        }),
        Ok(())
    );
    assert_eq!(
        commit(|c| c.removed_ids = vec!["m1".into(); MAX_CHANNEL_COMMIT_ITEMS + 1]),
        Err(TooLarge)
    );
    for seq in ["-1", "x", ""] {
        let commit = ChannelTimelineCommit {
            channel_id: "c1".into(),
            seq: Some(seq.into()),
            ..ChannelTimelineCommit::default()
        };
        assert_eq!(commit.validate(), Err(InvalidSeq), "{seq}");
    }
    assert_eq!(
        commit(|c| c.watermark = Some(ChannelWatermark::Lower)),
        Err(InvalidSeq)
    );
    assert_eq!(
        commit(|c| {
            c.seq = Some("4".into());
            c.watermark = advance("5");
        }),
        Err(InvalidSeq)
    );
    // Coverage says what a page listed, so it needs the page's sequence.
    assert_eq!(
        commit(|c| {
            c.seq = Some("4".into());
            c.coverage.push(coverage(None, "10", "20"));
        }),
        Err(InvalidCommit)
    );
    assert_eq!(
        commit(|c| {
            c.seq = Some("4".into());
            c.watermark = advance("3");
            c.coverage.push(coverage(None, "10", "20"));
        }),
        Err(InvalidCommit)
    );
    assert_eq!(
        commit(|c| {
            c.seq = Some("4".into());
            c.watermark = Some(ChannelWatermark::Lower);
            c.coverage
                .push(coverage(Some("m1"), TIMELINE_START, TIMELINE_HEAD));
        }),
        Ok(())
    );
    assert_eq!(
        commit(|c| c.coverage.push(coverage(None, "20", "10"))),
        Err(InvalidSpan)
    );
    // Everything held is dropped, so there is nothing to continue from.
    assert_eq!(commit(|c| c.reset = true), Err(InvalidSeq));
    assert_eq!(
        commit(|c| {
            c.reset = true;
            c.seq = Some("4".into());
            c.watermark = advance("3");
        }),
        Err(InvalidCommit)
    );
    assert_eq!(
        commit(|c| {
            c.reset = true;
            c.seq = Some("4".into());
            c.watermark = Some(ChannelWatermark::Lower);
        }),
        Ok(())
    );
}

#[test]
fn coverage_groups_by_list() {
    let commit = ChannelTimelineCommit {
        channel_id: "c1".into(),
        coverage: vec![
            coverage(None, "10", "20"),
            coverage(Some("m1"), TIMELINE_START, TIMELINE_HEAD),
            coverage(None, "30", "40"),
        ],
        ..ChannelTimelineCommit::default()
    };
    assert_eq!(
        commit.coverage_by_scope(),
        [
            (
                TimelineScope::Channel("c1".into()),
                vec![span("10", "20"), span("30", "40")]
            ),
            (
                TimelineScope::Thread("m1".into()),
                vec![span(TIMELINE_START, TIMELINE_HEAD)]
            ),
        ]
        .into()
    );
}

#[test]
fn commits_and_outcomes_use_the_host_wire_shape() {
    let commit: ChannelTimelineCommit = serde_json::from_value(serde_json::json!({
        "channelId": "c1",
        "seq": "4",
        "watermark": {"kind": "advance", "from": "3"},
        "coverage": [{"start": "10", "end": "20"}, {"threadRootId": "m1", "start": "", "end": TIMELINE_HEAD}],
        "removedIds": ["m2"],
        "droppedThreadRootIds": ["m3"],
        "touchedAtMs": 5,
    }))
    .unwrap();
    assert_eq!(commit.coverage[1].thread_root_id.as_deref(), Some("m1"));
    assert_eq!(
        (commit.seq.as_deref(), &commit.watermark, commit.reset),
        (Some("4"), &advance("3"), false)
    );
    let lower: ChannelWatermark =
        serde_json::from_value(serde_json::json!({"kind": "lower"})).unwrap();
    assert_eq!(lower, ChannelWatermark::Lower);
    assert_eq!(
        serde_json::to_value(ChannelCommitOutcome {
            channel_id: "c1".into(),
            seq: None,
            outcome: ChannelCommitStatus::Unheld,
        })
        .unwrap(),
        serde_json::json!({"channelId": "c1", "seq": null, "outcome": "unheld"})
    );
}
