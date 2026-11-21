use super::*;
use std::collections::{BTreeMap, HashMap};

fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[id])
}

fn text(value: &str) -> CacheValue {
    CacheValue::String(value.into())
}

fn message(fields: &[(&str, CacheValue)]) -> Record {
    let mut record = Record::default();
    record.fields.insert("channelId".into(), text("c1"));
    for (field, value) in fields {
        record.fields.insert((*field).into(), value.clone());
    }
    record
}

fn thread(reply_count: u64, deleted: bool) -> CacheValue {
    let mut fields = BTreeMap::new();
    fields.insert(
        "replyCount".to_owned(),
        CacheValue::Number(CacheNumber::PosInt(reply_count)),
    );
    fields.insert(
        "deletedAt".to_owned(),
        if deleted {
            text("2026-01-01T00:00:00Z")
        } else {
            CacheValue::Null
        },
    );
    CacheValue::Object(fields)
}

fn row(id: &str, sort_key: &str) -> ChannelTimelineRow {
    ChannelTimelineRow {
        record_key: key(id),
        channel_id: "c1".into(),
        scope: TimelineScope::Channel("c1".into()),
        sort_key: sort_key.into(),
        hidden: false,
    }
}

fn span(start: &str, end: &str) -> TimelineSpan {
    TimelineSpan {
        start: start.into(),
        end: end.into(),
    }
}

fn request(limit: u16) -> ChannelTimelineRequest {
    ChannelTimelineRequest {
        channel_id: "c1".into(),
        thread_root_id: None,
        limit,
        before: None,
        after: None,
        around: None,
    }
}

fn ids(result: &ChannelTimelineResult) -> Vec<&str> {
    result.keys.iter().filter_map(EntityKey::id).collect()
}

#[test]
fn roots_and_replies_project_into_their_own_lists() {
    let root = project_channel_timeline(&key("m1"), &message(&[("sortKey", text("05"))])).unwrap();
    assert_eq!(root.scope, TimelineScope::Channel("c1".into()));
    assert_eq!((root.sort_key.as_str(), root.hidden), ("05", false));

    let reply = project_channel_timeline(
        &key("m2"),
        &message(&[("sortKey", text("~-06")), ("threadId", text("m1"))]),
    )
    .unwrap();
    assert_eq!(reply.scope, TimelineScope::Thread("m1".into()));

    let activity = project_channel_timeline(
        &EntityKey::entity(ACTIVITY_TYPENAME, &["a1"]),
        // An activity never has a thread, even if a stray field says so.
        &message(&[("sortKey", text("07")), ("threadId", text("m1"))]),
    )
    .unwrap();
    assert_eq!(activity.scope, TimelineScope::Channel("c1".into()));
}

#[test]
fn records_that_are_not_entries_project_to_nothing() {
    let record = message(&[("sortKey", text("05"))]);
    assert!(
        project_channel_timeline(&EntityKey::entity("GraphqlSoupChannel", &["m1"]), &record)
            .is_none()
    );
    assert!(project_channel_timeline(&key("m1"), &message(&[])).is_none());
    assert!(project_channel_timeline(&key("m1"), &message(&[("sortKey", text("a b"))])).is_none());
    let mut deleted = record.clone();
    deleted
        .fields
        .insert(DELETED_FIELD.into(), CacheValue::Bool(true));
    assert!(project_channel_timeline(&key("m1"), &deleted).is_none());
    let mut aliased = record;
    aliased
        .fields
        .insert(ALIAS_FIELD.into(), text("GraphqlChannelMessage:m9"));
    assert!(project_channel_timeline(&key("m1"), &aliased).is_none());
}

#[test]
fn tombstones_hide_like_the_server_timeline() {
    let hidden = |fields: &[(&str, CacheValue)]| {
        project_channel_timeline(&key("m1"), &message(fields))
            .unwrap()
            .hidden
    };
    let deleted = ("deletedAt", text("2026-01-01T00:00:00Z"));
    let sort = ("sortKey", text("05"));
    assert!(!hidden(&[sort.clone(), ("thread", thread(0, false))]));
    assert!(hidden(&[sort.clone(), deleted.clone()]));
    assert!(hidden(&[
        sort.clone(),
        deleted.clone(),
        ("thread", thread(0, false))
    ]));
    // A deleted root with a live reply stays, as a tombstone.
    assert!(!hidden(&[
        sort.clone(),
        deleted.clone(),
        ("thread", thread(2, false))
    ]));
    // A deleted thread leaves entirely.
    assert!(hidden(&[sort.clone(), ("thread", thread(2, true))]));
    // A deleted reply leaves its thread.
    assert!(hidden(&[sort, deleted, ("threadId", text("m0"))]));
}

#[test]
fn spans_merge_when_they_overlap_or_touch() {
    assert_eq!(
        merge_spans([
            span("30", "40"),
            span("10", "20"),
            span("20", "25"),
            span("35", TIMELINE_HEAD)
        ]),
        [span("10", "25"), span("30", TIMELINE_HEAD)]
    );
    assert_eq!(
        merge_spans([span("10", "30"), span("15", "20")]),
        [span("10", "30")]
    );
    assert_eq!(merge_spans([span("20", "10")]), []);
    let spans = [span(TIMELINE_START, "20"), span("30", TIMELINE_HEAD)];
    assert_eq!(covering_span(&spans, "20"), Some(&spans[0]));
    assert_eq!(covering_span(&spans, "25"), None);
    assert_eq!(covering_span(&spans, TIMELINE_HEAD), Some(&spans[1]));
}

#[test]
fn sentinels_bound_every_sort_key() {
    for sort_key in [
        "0",
        "00000001712345678901-0190aaaa",
        "~-00000001712345678901-ffff",
        "~~~~",
    ] {
        assert!(is_sort_key(sort_key));
        assert!(TIMELINE_START < sort_key && sort_key < TIMELINE_HEAD);
    }
    assert!(!is_sort_key(""));
    assert!(!is_sort_key(TIMELINE_HEAD));
}

#[test]
fn requests_validate_their_window() {
    assert_eq!(request(50).validate(), Ok(()));
    assert_eq!(
        request(0).validate(),
        Err(ChannelTimelineError::InvalidLimit)
    );
    assert_eq!(
        request(101).validate(),
        Err(ChannelTimelineError::InvalidLimit)
    );
    let mut both = request(50);
    both.before = Some("10".into());
    both.after = Some("05".into());
    assert_eq!(both.validate(), Err(ChannelTimelineError::InvalidWindow));
    let mut cursor = request(50);
    cursor.before = Some(TIMELINE_HEAD.into());
    assert_eq!(cursor.validate(), Err(ChannelTimelineError::InvalidWindow));
    let mut around = request(50);
    around.around = Some(EntityKey::entity(ACTIVITY_TYPENAME, &["a1"]));
    assert_eq!(around.validate(), Err(ChannelTimelineError::InvalidKey));
}

#[test]
fn commits_validate_spans_keys_and_sequences() {
    let commit = |edit: fn(&mut ChannelTimelineCommit)| {
        let mut commit = ChannelTimelineCommit {
            channel_id: "c1".into(),
            ..ChannelTimelineCommit::default()
        };
        edit(&mut commit);
        commit.validate()
    };
    assert_eq!(commit(|_| {}), Ok(()));
    assert_eq!(
        commit(|c| c.channel_id.clear()),
        Err(ChannelTimelineError::InvalidKey)
    );
    assert_eq!(
        commit(|c| c.coverage.push(ChannelCoverage {
            thread_root_id: None,
            span: span("20", "10")
        })),
        Err(ChannelTimelineError::InvalidSpan)
    );
    assert_eq!(
        commit(|c| c.coverage.push(ChannelCoverage {
            thread_root_id: None,
            span: span(TIMELINE_START, TIMELINE_HEAD)
        })),
        Ok(())
    );
    assert_eq!(
        commit(|c| c
            .removed_keys
            .push(EntityKey::entity("GraphqlSoupChannel", &["x"]))),
        Err(ChannelTimelineError::InvalidKey)
    );
    assert_eq!(
        commit(|c| c.seq = Some(ChannelSeqUpdate::Lower { seq: "-1".into() })),
        Err(ChannelTimelineError::InvalidSeq)
    );
    assert_eq!(
        commit(|c| c.seq = Some(ChannelSeqUpdate::Advance {
            from: "5".into(),
            to: "4".into()
        })),
        Err(ChannelTimelineError::InvalidSeq)
    );
}

#[test]
fn the_applied_sequence_never_skips_a_change() {
    let with = |seq: ChannelSeqUpdate, reset: bool| ChannelTimelineCommit {
        channel_id: "c1".into(),
        seq: Some(seq),
        reset,
        ..ChannelTimelineCommit::default()
    };
    let lower = |seq: &str| ChannelSeqUpdate::Lower { seq: seq.into() };
    let advance = |from: &str, to: &str| ChannelSeqUpdate::Advance {
        from: from.into(),
        to: to.into(),
    };

    // A page read at an older sequence pulls the whole channel back to it.
    assert_eq!(next_seq(None, &with(lower("7"), false)), Some(7));
    assert_eq!(next_seq(Some(9), &with(lower("7"), false)), Some(7));
    assert_eq!(next_seq(Some(5), &with(lower("7"), false)), Some(5));
    // A push applies only on top of exactly the previous change.
    assert_eq!(next_seq(Some(7), &with(advance("7", "8"), false)), Some(8));
    assert_eq!(next_seq(Some(6), &with(advance("7", "8"), false)), Some(6));
    assert_eq!(next_seq(Some(9), &with(advance("7", "8"), false)), Some(9));
    assert_eq!(next_seq(None, &with(advance("7", "8"), false)), None);
    // A reset forgets the stored sequence first.
    assert_eq!(next_seq(Some(3), &with(lower("12"), true)), Some(12));
    assert_eq!(
        next_seq(Some(3), &with(advance("11", "12"), true)),
        Some(12)
    );
    assert_eq!(
        next_seq(
            Some(3),
            &ChannelTimelineCommit {
                reset: true,
                ..ChannelTimelineCommit::default()
            }
        ),
        None
    );
}

#[test]
fn windows_plan_against_the_span_holding_their_anchor() {
    let spans = [span("10", "20"), span("30", TIMELINE_HEAD)];
    let latest = plan_window(&request(2), None, &spans).unwrap();
    assert_eq!(
        (latest.span.clone(), latest.position.as_str()),
        (spans[1].clone(), TIMELINE_HEAD)
    );
    assert_eq!(
        (latest.read_older, latest.read_newer, latest.read_limit),
        (true, false, 3)
    );

    let mut before = request(2);
    before.before = Some("15".into());
    assert_eq!(plan_window(&before, None, &spans).unwrap().span, spans[0]);
    before.before = Some("25".into());
    assert_eq!(plan_window(&before, None, &spans), None);

    let mut around = request(2);
    around.around = Some(key("m1"));
    assert_eq!(plan_window(&around, None, &spans), None);
    let anchor = row("m1", "12");
    let plan = plan_window(&around, Some(&anchor), &spans).unwrap();
    assert!(plan.read_older && plan.read_newer);
    let hidden = ChannelTimelineRow {
        hidden: true,
        ..anchor.clone()
    };
    assert_eq!(plan_window(&around, Some(&hidden), &spans), None);
    let elsewhere = ChannelTimelineRow {
        scope: TimelineScope::Thread("m0".into()),
        ..anchor
    };
    assert_eq!(plan_window(&around, Some(&elsewhere), &spans), None);
    assert_eq!(anchor_root_key(&around, &elsewhere), Some(key("m0")));

    assert_eq!(plan_window(&request(2), None, &[span("10", "20")]), None);
}

fn snapshot(
    span: TimelineSpan,
    older: &[(&str, &str)],
    newer: &[(&str, &str)],
) -> ChannelTimelineSnapshot {
    ChannelTimelineSnapshot {
        span: Some(span),
        anchor: None,
        older: older.iter().map(|(id, sort)| row(id, sort)).collect(),
        newer: newer.iter().map(|(id, sort)| row(id, sort)).collect(),
        seq: Some(4),
    }
}

#[test]
fn the_latest_page_ends_at_the_head() {
    let none = HashMap::new();
    let page = compose_channel_window(
        &request(2),
        snapshot(
            span("10", TIMELINE_HEAD),
            &[("m5", "50"), ("m4", "40"), ("m3", "30")],
            &[],
        ),
        &none,
    );
    assert!(page.covered && !page.optimistic);
    assert_eq!(ids(&page), ["m5", "m4"]);
    assert_eq!(
        (page.older_cursor.as_deref(), page.newer_cursor.as_deref()),
        (Some("40"), None)
    );
    assert_eq!(page.seq.as_deref(), Some("4"));

    // The whole channel fits: nothing older to ask for.
    let whole = compose_channel_window(
        &request(5),
        snapshot(span(TIMELINE_START, TIMELINE_HEAD), &[("m5", "50")], &[]),
        &none,
    );
    assert_eq!(ids(&whole), ["m5"]);
    assert_eq!(whole.older_cursor, None);
    let empty = compose_channel_window(
        &request(5),
        snapshot(span(TIMELINE_START, TIMELINE_HEAD), &[], &[]),
        &none,
    );
    assert!(empty.covered && empty.keys.is_empty() && empty.older_cursor.is_none());
}

#[test]
fn pages_stop_at_the_edge_of_what_was_fetched() {
    let none = HashMap::new();
    let mut before = request(3);
    before.before = Some("40".into());
    // Fewer rows than asked, and the stretch does not reach the start: a
    // short page whose cursor continues at the edge.
    let short = compose_channel_window(
        &before,
        snapshot(span("30", "60"), &[("m3", "30")], &[]),
        &none,
    );
    assert!(short.covered);
    assert_eq!(ids(&short), ["m3"]);
    assert_eq!(
        (short.older_cursor.as_deref(), short.newer_cursor.as_deref()),
        (Some("30"), Some("30"))
    );
    // Nothing at all below the cursor inside the stretch: the server answers.
    before.before = Some("30".into());
    let miss = compose_channel_window(&before, snapshot(span("30", "60"), &[], &[]), &none);
    assert!(!miss.covered && miss.keys.is_empty());
    assert_eq!(miss.seq.as_deref(), Some("4"));
    // No stretch holds the anchor at all.
    let unknown = compose_channel_window(&before, ChannelTimelineSnapshot::default(), &none);
    assert!(!unknown.covered && unknown.seq.is_none());

    let mut after = request(2);
    after.after = Some("30".into());
    let newer = compose_channel_window(
        &after,
        snapshot(
            span("10", TIMELINE_HEAD),
            &[],
            &[("m4", "40"), ("m5", "50")],
        ),
        &none,
    );
    assert_eq!(ids(&newer), ["m5", "m4"]);
    assert_eq!(
        (newer.older_cursor.as_deref(), newer.newer_cursor.as_deref()),
        (Some("40"), None)
    );
    let more = compose_channel_window(
        &after,
        snapshot(
            span("10", TIMELINE_HEAD),
            &[],
            &[("m4", "40"), ("m5", "50"), ("m6", "60")],
        ),
        &none,
    );
    assert_eq!(
        (ids(&more), more.newer_cursor.as_deref()),
        (vec!["m5", "m4"], Some("50"))
    );
}

#[test]
fn around_centres_the_page_on_its_anchor() {
    let mut around = request(5);
    around.around = Some(key("m5"));
    let mut snap = snapshot(
        span("10", "90"),
        &[("m4", "40"), ("m3", "30"), ("m2", "20"), ("m1", "10")],
        &[("m6", "60"), ("m7", "70"), ("m8", "80")],
    );
    snap.anchor = Some(row("m5", "50"));
    let page = compose_channel_window(&around, snap.clone(), &HashMap::new());
    assert_eq!(ids(&page), ["m7", "m6", "m5", "m4", "m3"]);
    assert_eq!(
        (page.older_cursor.as_deref(), page.newer_cursor.as_deref()),
        (Some("30"), Some("70"))
    );

    snap.anchor = None;
    assert!(!compose_channel_window(&around, snap, &HashMap::new()).covered);
}

#[test]
fn pending_mutations_replace_stored_rows() {
    let stored = snapshot(
        span("10", TIMELINE_HEAD),
        &[("m5", "50"), ("m4", "40"), ("m3", "30")],
        &[],
    );
    let mut overlay = HashMap::new();
    // A pending send above everything, a pending delete of m4, and a pending
    // message older than the page that must not leak into it.
    overlay.insert(key("local"), Some(row("local", "99")));
    overlay.insert(key("m4"), None);
    overlay.insert(key("old"), Some(row("old", "15")));
    let page = compose_channel_window(&request(2), stored.clone(), &overlay);
    assert!(page.covered && page.optimistic);
    assert_eq!(ids(&page), ["local", "m5"]);
    assert_eq!(page.older_cursor.as_deref(), Some("50"));

    let mut untouched = HashMap::new();
    untouched.insert(
        key("other"),
        Some(ChannelTimelineRow {
            scope: TimelineScope::Channel("c2".into()),
            ..row("other", "45")
        }),
    );
    let page = compose_channel_window(&request(2), stored, &untouched);
    assert!(!page.optimistic);
    assert_eq!(ids(&page), ["m5", "m4"]);
}

#[test]
fn coverage_groups_by_scope() {
    let commit = ChannelTimelineCommit {
        channel_id: "c1".into(),
        coverage: vec![
            ChannelCoverage {
                thread_root_id: None,
                span: span("10", "20"),
            },
            ChannelCoverage {
                thread_root_id: Some("m1".into()),
                span: span(TIMELINE_START, TIMELINE_HEAD),
            },
            ChannelCoverage {
                thread_root_id: None,
                span: span("30", "40"),
            },
        ],
        ..ChannelTimelineCommit::default()
    };
    assert_eq!(
        commit_coverage_by_scope(&commit),
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
    );
}

#[test]
fn commits_and_results_use_the_host_wire_shape() {
    let commit: ChannelTimelineCommit = serde_json::from_value(serde_json::json!({
        "channelId": "c1",
        "coverage": [{"start": "10", "end": "20"}, {"threadRootId": "m1", "start": "", "end": TIMELINE_HEAD}],
        "seq": {"kind": "advance", "from": "3", "to": "4"},
        "touchedAtMs": 5,
    }))
    .unwrap();
    assert_eq!(commit.coverage[1].thread_root_id.as_deref(), Some("m1"));
    assert_eq!(
        commit.seq,
        Some(ChannelSeqUpdate::Advance {
            from: "3".into(),
            to: "4".into()
        })
    );
    assert_eq!(
        serde_json::to_value(ChannelTimelineResult {
            covered: true,
            older_cursor: Some("10".into()),
            ..Default::default()
        })
        .unwrap(),
        serde_json::json!({"covered": true, "keys": [], "olderCursor": "10", "newerCursor": null, "seq": null, "optimistic": false})
    );
}
