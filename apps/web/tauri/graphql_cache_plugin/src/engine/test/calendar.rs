use super::*;
use cache_core::calendar::{CalendarCommit, CalendarRangeRequest};

fn week() -> CalendarRangeRequest {
    serde_json::from_value(serde_json::json!({
        "startMs": 1_791_158_400_000_i64,
        "endMs": 1_791_763_200_000_i64,
        "startDay": 20_731,
        "endDay": 20_738,
    }))
    .unwrap()
}

fn range(handle: &EngineHandle) -> serde_json::Value {
    serde_json::to_value(block_on(handle.calendar_range(week())).unwrap()).unwrap()
}

#[test]
fn calendar_range_and_commit_cross_the_ipc_boundary() {
    let handle = spawn_handle();
    let empty = range(&handle);
    assert_eq!(empty["kind"], "range");
    assert_eq!(empty["occurrenceKeys"], serde_json::json!([]));
    assert_eq!(
        empty["gaps"],
        serde_json::json!([
            { "kind": "timed", "start": 1_791_158_400_000_i64, "end": 1_791_763_200_000_i64 },
            { "kind": "allDay", "start": 20_731, "end": 20_738 },
        ])
    );
    assert_eq!(empty["watermark"], serde_json::Value::Null);

    let commit: CalendarCommit = serde_json::from_value(serde_json::json!({
        "coverage": empty["gaps"],
        "watermark": { "kind": "merge", "links": [{ "linkId": "l1", "seq": "3" }] },
        "freshness": "stale",
    }))
    .unwrap();
    let committed = block_on(handle.calendar_commit(commit)).unwrap();
    assert!(committed.revision_advanced);
    assert!(committed.changed.is_empty());

    block_on(handle.enqueue_optimistic_mutation(
        None,
        "00000000-0000-4000-8000-0000000000c1".to_string(),
        QUERY.to_string(),
        Some("Soup".to_string()),
        variables(),
        soup_data(false),
        vec![],
        vec![],
        vec![],
        0,
        "runner".to_string(),
        10,
        1_000,
        None,
        vec!["GraphqlCalendarEvent:e1".to_string()],
    ))
    .unwrap();
    let covered = range(&handle);
    assert_eq!(covered["gaps"], serde_json::json!([]));
    assert_eq!(covered["freshness"], "stale");
    assert_eq!(
        covered["watermark"],
        serde_json::json!([{ "linkId": "l1", "seq": "3" }])
    );
    assert_eq!(
        covered["uncertainEventKeys"],
        serde_json::json!(["GraphqlCalendarEvent:e1"])
    );
    assert_eq!(covered["optimistic"], true);
}

#[test]
fn invalid_calendar_commits_are_rejected() {
    let handle = spawn_handle();
    let commit: CalendarCommit = serde_json::from_value(serde_json::json!({
        "deletedEventKeys": ["GraphqlCalendar:c1"],
    }))
    .unwrap();
    assert!(block_on(handle.calendar_commit(commit)).is_err());
}
