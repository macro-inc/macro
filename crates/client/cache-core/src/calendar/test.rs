use super::*;
use std::collections::{BTreeMap, HashMap};

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn text(value: &str) -> CacheValue {
    CacheValue::String(value.into())
}

fn time(fields: &[(&str, &str)]) -> CacheValue {
    CacheValue::Object(
        fields
            .iter()
            .map(|(field, value)| ((*field).to_owned(), text(value)))
            .collect::<BTreeMap<_, _>>(),
    )
}

fn occurrence(time_value: CacheValue) -> Record {
    let mut record = Record::default();
    record
        .fields
        .insert("__typename".into(), text(OCCURRENCE_TYPENAME));
    record.fields.insert("eventId".into(), text("e1"));
    record.fields.insert("linkId".into(), text("l1"));
    record
        .fields
        .insert("isCancelled".into(), CacheValue::Bool(false));
    record.fields.insert("time".into(), time_value);
    record
}

fn timed(starts_at: &str, ends_at: &str) -> CacheValue {
    time(&[
        ("__typename", "GraphqlTimedEventTime"),
        ("startsAt", starts_at),
        ("endsAt", ends_at),
    ])
}

fn all_day(start_date: &str, end_date: &str) -> CacheValue {
    time(&[
        ("__typename", "GraphqlAllDayEventTime"),
        ("startDate", start_date),
        ("endDate", end_date),
    ])
}

fn span(kind: CalendarSpanKind, start: i64, end: i64) -> CalendarSpan {
    CalendarSpan { kind, start, end }
}

fn timed_span(start: i64, end: i64) -> CalendarSpan {
    span(CalendarSpanKind::Timed, start, end)
}

fn link(link_id: &str, seq: i64) -> CalendarLinkWatermark {
    CalendarLinkWatermark {
        link_id: link_id.into(),
        seq,
    }
}

fn row(record_key: &str, event: &str, span: CalendarSpan) -> CalendarRangeRow {
    CalendarRangeRow {
        record_key: key(record_key),
        event_key: EntityKey::entity(EVENT_TYPENAME, &[event]),
        link_id: "l1".into(),
        span,
    }
}

fn request(start_ms: i64, end_ms: i64) -> CalendarRangeRequest {
    CalendarRangeRequest {
        start_ms,
        end_ms,
        start_day: 0,
        end_day: 0,
        event_key: None,
    }
}

#[test]
fn projects_timed_and_all_day_occurrences() {
    let occurrence_key = key("GraphqlCalendarOccurrence:e1:2026-10-06T12:00:00+00:00");
    let projected = project_calendar_range(
        &occurrence_key,
        &occurrence(timed(
            "2026-10-06T12:00:00+00:00",
            "2026-10-06T13:30:00+00:00",
        )),
    )
    .unwrap();
    assert_eq!(projected.record_key, occurrence_key);
    assert_eq!(projected.event_key.as_ref(), "GraphqlCalendarEvent:e1");
    assert_eq!(projected.link_id, "l1");
    assert_eq!(
        projected.span,
        timed_span(1_791_288_000_000, 1_791_293_400_000)
    );
    assert!(!projected.is_long());

    let projected = project_calendar_range(
        &key("GraphqlCalendarOccurrence:e1:2026-10-06"),
        &occurrence(all_day("2026-10-06", "2026-10-07")),
    )
    .unwrap();
    assert_eq!(
        projected.span,
        span(CalendarSpanKind::AllDay, 20_732, 20_733)
    );

    // Offsets are normalized to UTC instants.
    let projected = project_calendar_range(
        &occurrence_key,
        &occurrence(timed(
            "2026-10-06T08:00:00-04:00",
            "2026-10-06T09:00:00-04:00",
        )),
    )
    .unwrap();
    assert_eq!(projected.span.start, 1_791_288_000_000);
}

#[test]
fn infers_the_time_kind_without_a_typename_and_flags_long_spans() {
    let projected = project_calendar_range(
        &key("GraphqlCalendarOccurrence:e1:k"),
        &occurrence(time(&[
            ("startDate", "2026-10-01"),
            ("endDate", "2026-10-09"),
        ])),
    )
    .unwrap();
    assert_eq!(projected.span.kind, CalendarSpanKind::AllDay);
    assert!(projected.is_long());

    let projected = project_calendar_range(
        &key("GraphqlCalendarOccurrence:e1:k"),
        &occurrence(timed("2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z")),
    )
    .unwrap();
    assert!(!projected.is_long(), "exactly seven days stays short");
}

#[test]
fn hidden_or_incomplete_occurrences_do_not_project() {
    let occurrence_key = key("GraphqlCalendarOccurrence:e1:k");
    let valid = occurrence(timed("2026-10-06T12:00:00Z", "2026-10-06T13:00:00Z"));
    assert!(project_calendar_range(&occurrence_key, &valid).is_some());
    assert!(project_calendar_range(&key("GraphqlCalendarEvent:e1"), &valid).is_none());

    let hidden = [
        (DELETED_FIELD, CacheValue::Bool(true)),
        (ALIAS_FIELD, text("GraphqlCalendarOccurrence:server")),
        ("isCancelled", CacheValue::Bool(true)),
        ("eventId", CacheValue::Null),
        ("linkId", text("")),
        ("time", CacheValue::Null),
        (
            "time",
            timed("2026-10-06T13:00:00Z", "2026-10-06T12:00:00Z"),
        ),
        ("time", all_day("2026-10-06", "2026-10-06")),
        ("time", all_day("2026-10-07", "2026-10-06")),
        (
            "time",
            timed("2026-10-06T13:00:00.0009Z", "2026-10-06T13:00:00.0001Z"),
        ),
        ("time", timed("not a date", "2026-10-06T13:00:00Z")),
        (
            "time",
            time(&[("__typename", "Unknown"), ("startDate", "2026-10-06")]),
        ),
    ];
    for (field, value) in hidden {
        let mut record = valid.clone();
        record.fields.insert(field.into(), value);
        assert!(
            project_calendar_range(&occurrence_key, &record).is_none(),
            "{field} should hide the occurrence"
        );
    }
}

#[test]
fn timed_points_project_and_use_left_inclusive_right_exclusive_membership() {
    let occurrence_key = key("GraphqlCalendarOccurrence:e1:point");
    let projected = project_calendar_range(
        &occurrence_key,
        &occurrence(timed("2026-10-06T08:00:00-04:00", "2026-10-06T12:00:00Z")),
    )
    .unwrap();
    assert_eq!(
        projected.span,
        timed_span(1_791_288_000_000, 1_791_288_000_000)
    );
    assert!(!projected.is_long());

    let viewport = timed_span(10, 20);
    for (at, expected) in [(9, false), (10, true), (15, true), (20, false)] {
        let point = timed_span(at, at);
        assert_eq!(point.overlaps(&viewport), expected);
        assert_eq!(viewport.overlaps(&point), expected);
        assert_eq!(
            request(10, 20).includes(&row("point", "e1", point)),
            expected
        );
    }
    assert!(!request(15, 15).includes(&row("point", "e1", timed_span(15, 15))));
    assert!(!request(15, 15).includes(&row("duration", "e1", timed_span(10, 20))));
    assert!(!span(CalendarSpanKind::AllDay, 15, 15).overlaps(&span(
        CalendarSpanKind::AllDay,
        10,
        20
    )));
}

#[test]
fn merges_spans_per_kind_including_adjacent_spans() {
    let merged = merge_spans([
        timed_span(10, 20),
        timed_span(0, 5),
        timed_span(20, 30),
        timed_span(4, 8),
        timed_span(40, 40),
        span(CalendarSpanKind::AllDay, 0, 10),
        span(CalendarSpanKind::AllDay, 5, 6),
    ]);
    assert_eq!(
        merged,
        [
            timed_span(0, 8),
            timed_span(10, 30),
            span(CalendarSpanKind::AllDay, 0, 10),
        ]
    );
}

#[test]
fn gaps_are_the_uncovered_parts_of_the_request() {
    let coverage = [
        timed_span(10, 20),
        timed_span(30, 40),
        span(CalendarSpanKind::AllDay, 0, 100),
    ];
    assert_eq!(
        coverage_gaps(&coverage, timed_span(0, 50)),
        [timed_span(0, 10), timed_span(20, 30), timed_span(40, 50)]
    );
    assert_eq!(coverage_gaps(&coverage, timed_span(12, 18)), []);
    assert_eq!(
        coverage_gaps(&coverage, timed_span(15, 35)),
        [timed_span(20, 30)]
    );
    assert_eq!(
        coverage_gaps(&coverage, timed_span(40, 45)),
        [timed_span(40, 45)]
    );
    assert_eq!(coverage_gaps(&coverage, timed_span(5, 5)), []);
    assert_eq!(
        coverage_gaps(&[], span(CalendarSpanKind::AllDay, 1, 2)),
        [span(CalendarSpanKind::AllDay, 1, 2)]
    );
}

#[test]
fn page_watermarks_lower_each_link_and_adopt_new_links() {
    let stored = [link("a", 10), link("b", 5)];
    let merged = apply_watermark_update(
        Some(&stored),
        Some(&CalendarWatermarkUpdate::Merge {
            links: vec![link("a", 7), link("b", 9), link("c", 3)],
        }),
        &[],
    );
    assert_eq!(merged, [link("a", 7), link("b", 5), link("c", 3)]);
    let again = apply_watermark_update(
        Some(&merged),
        Some(&CalendarWatermarkUpdate::Merge {
            links: vec![link("a", 7), link("b", 9), link("c", 3)],
        }),
        &[],
    );
    assert_eq!(again, merged, "re-delivery is idempotent");
}

#[test]
fn deltas_advance_untouched_links_and_keep_concurrent_lowerings() {
    let since = vec![link("a", 10), link("b", 5)];
    let to = vec![link("a", 20), link("b", 8), link("c", 4)];
    let advance = CalendarWatermarkUpdate::Advance {
        since: since.clone(),
        to,
    };
    assert_eq!(
        apply_watermark_update(Some(&since), Some(&advance), &[]),
        [link("a", 20), link("b", 8), link("c", 4)]
    );

    // A page lowered `a` while the delta was in flight: its change is replayed.
    let lowered = [link("a", 3), link("b", 5)];
    assert_eq!(
        apply_watermark_update(Some(&lowered), Some(&advance), &[]),
        [link("a", 3), link("b", 8), link("c", 4)]
    );

    // A delta from an empty watermark bootstraps every link.
    let bootstrap = CalendarWatermarkUpdate::Advance {
        since: Vec::new(),
        to: vec![link("a", 2)],
    };
    assert_eq!(
        apply_watermark_update(None, Some(&bootstrap), &[]),
        [link("a", 2)]
    );
}

#[test]
fn removed_links_leave_the_watermark() {
    assert_eq!(
        apply_watermark_update(Some(&[link("a", 1), link("b", 2)]), None, &["a".to_owned()]),
        [link("b", 2)]
    );
}

#[test]
fn watermark_seq_crosses_the_wire_as_a_decimal_string() {
    let encoded = serialize_watermark(&[link("a", 9_007_199_254_740_993)]);
    assert_eq!(encoded, r#"[{"linkId":"a","seq":"9007199254740993"}]"#);
    assert_eq!(
        parse_watermark(&encoded).unwrap(),
        [link("a", 9_007_199_254_740_993)]
    );
    assert!(parse_watermark(r#"[{"linkId":"a","seq":"-1"}]"#).is_none());
    assert!(parse_watermark(r#"[{"linkId":"a","seq":1}]"#).is_none());
}

#[test]
fn sync_state_resets_before_applying_the_commit() {
    let stored = CalendarSyncState {
        watermark: Some(vec![link("a", 10), link("b", 4)]),
        freshness: CalendarFreshness::Fresh,
    };
    let reset = CalendarCommit {
        reset: true,
        watermark: Some(CalendarWatermarkUpdate::Advance {
            since: vec![link("a", 10)],
            to: vec![link("a", 30)],
        }),
        ..CalendarCommit::default()
    };
    assert_eq!(
        next_sync_state(&stored, &reset),
        CalendarSyncState {
            watermark: Some(vec![link("a", 30)]),
            freshness: CalendarFreshness::Unknown,
        }
    );

    let stale = CalendarCommit {
        freshness: Some(CalendarFreshness::Stale),
        ..CalendarCommit::default()
    };
    assert_eq!(
        next_sync_state(&CalendarSyncState::default(), &stale),
        CalendarSyncState {
            watermark: None,
            freshness: CalendarFreshness::Stale,
        }
    );
}

#[test]
fn commits_reject_foreign_keys_and_invalid_sync_values() {
    let valid = CalendarCommit {
        coverage: vec![timed_span(0, 1)],
        replaced_events: vec![CalendarReplacedEvent {
            event_key: key("GraphqlCalendarEvent:e1"),
            occurrence_keys: vec![key("GraphqlCalendarOccurrence:e1:k")],
        }],
        deleted_event_keys: vec![key("GraphqlCalendarEvent:e2")],
        deleted_calendar_keys: vec![key("GraphqlCalendar:c1")],
        removed_link_ids: vec!["l2".into()],
        watermark: Some(CalendarWatermarkUpdate::Merge {
            links: vec![link("l1", 1)],
        }),
        freshness: Some(CalendarFreshness::Fresh),
        reset: false,
    };
    assert_eq!(valid.validate(), Ok(()));

    let invalid = [
        (
            CalendarCommit {
                coverage: vec![timed_span(2, 1)],
                ..valid.clone()
            },
            CalendarError::InvalidSpan,
        ),
        (
            CalendarCommit {
                deleted_event_keys: vec![key("GraphqlCalendar:e2")],
                ..valid.clone()
            },
            CalendarError::InvalidKey,
        ),
        (
            CalendarCommit {
                replaced_events: vec![CalendarReplacedEvent {
                    event_key: key("GraphqlCalendarEvent:e1"),
                    occurrence_keys: vec![key("GraphqlCalendarEvent:e1")],
                }],
                ..valid.clone()
            },
            CalendarError::InvalidKey,
        ),
        (
            CalendarCommit {
                freshness: Some(CalendarFreshness::Unknown),
                ..valid.clone()
            },
            CalendarError::InvalidFreshness,
        ),
        (
            CalendarCommit {
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 1), link("l1", 2)],
                }),
                ..valid.clone()
            },
            CalendarError::InvalidWatermark,
        ),
        (
            CalendarCommit {
                coverage: vec![timed_span(0, 1); MAX_CALENDAR_COMMIT_ITEMS + 1],
                ..valid.clone()
            },
            CalendarError::TooLarge,
        ),
    ];
    for (commit, error) in invalid {
        assert_eq!(commit.validate(), Err(error));
    }
}

#[test]
fn requests_validate_spans_and_event_filters() {
    assert_eq!(request(0, 0).validate(), Ok(()));
    assert_eq!(request(2, 1).validate(), Err(CalendarError::InvalidSpan));
    let mut filtered = request(0, 10);
    filtered.event_key = Some(key("GraphqlCalendarOccurrence:e1:k"));
    assert_eq!(filtered.validate(), Err(CalendarError::InvalidKey));
    filtered.event_key = Some(key("GraphqlCalendarEvent:e1"));
    assert_eq!(filtered.validate(), Ok(()));
}

#[test]
fn overlay_replaces_moves_hides_and_adds_rows() {
    let request = request(0, 100);
    let authoritative = vec![
        row("GraphqlCalendarOccurrence:e1:a", "e1", timed_span(10, 20)),
        row("GraphqlCalendarOccurrence:e1:b", "e1", timed_span(30, 40)),
        row("GraphqlCalendarOccurrence:e2:c", "e2", timed_span(50, 60)),
    ];
    let (keys, optimistic) =
        compose_calendar_rows(&request, authoritative.clone(), &HashMap::new());
    assert!(!optimistic);
    assert_eq!(
        keys,
        authoritative
            .iter()
            .map(|row| row.record_key.clone())
            .collect::<Vec<_>>()
    );

    let overlay = HashMap::from([
        // Moved earlier inside the range.
        (
            key("GraphqlCalendarOccurrence:e1:b"),
            Some(row(
                "GraphqlCalendarOccurrence:e1:b",
                "e1",
                timed_span(0, 5),
            )),
        ),
        // Deleted.
        (key("GraphqlCalendarOccurrence:e2:c"), None),
        // Moved out of the range.
        (
            key("GraphqlCalendarOccurrence:e1:a"),
            Some(row(
                "GraphqlCalendarOccurrence:e1:a",
                "e1",
                timed_span(500, 600),
            )),
        ),
        // Created.
        (
            key("GraphqlCalendarOccurrence:local:d"),
            Some(row(
                "GraphqlCalendarOccurrence:local:d",
                "local",
                timed_span(70, 80),
            )),
        ),
    ]);
    let (keys, optimistic) = compose_calendar_rows(&request, authoritative, &overlay);
    assert!(optimistic);
    assert_eq!(
        keys,
        [
            key("GraphqlCalendarOccurrence:e1:b"),
            key("GraphqlCalendarOccurrence:local:d"),
        ]
    );
}

#[test]
fn event_filters_apply_to_overlay_rows() {
    let mut request = request(0, 100);
    request.event_key = Some(key("GraphqlCalendarEvent:e1"));
    let overlay = HashMap::from([(
        key("GraphqlCalendarOccurrence:e2:a"),
        Some(row(
            "GraphqlCalendarOccurrence:e2:a",
            "e2",
            timed_span(10, 20),
        )),
    )]);
    let (keys, optimistic) = compose_calendar_rows(&request, Vec::new(), &overlay);
    assert!(keys.is_empty());
    assert!(!optimistic);
}
