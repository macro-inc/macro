use super::*;
use serde_json::json;

fn now() -> DateTime<Utc> {
    "2026-11-02T12:00:00Z".parse().unwrap()
}

fn parse(body: Value) -> Result<SyncPlan, RequestError> {
    SyncPlan::from_json(
        body.to_string().as_bytes(),
        now(),
        MaterializedRange::around(now()),
    )
}

#[test]
fn accepts_a_pass_with_saved_lanes_and_calendar_coverage() {
    let plan = parse(json!({
        "protocol": 1,
        "pass": "first",
        "lanes": [
            { "id": "tasks", "resume": { "cursor": "c1", "items": 500, "passStartedAt": "2026-11-02T11:00:00.000Z" } },
            { "id": "calendar-near-0", "completedAt": "2026-11-01T00:00:00.000Z", "watermark": "2026-11-01T00:00:00.000Z" },
            { "id": "a-lane-this-server-no-longer-runs" },
        ],
        "calendar": {
            "timeZone": "Europe/Berlin",
            "coverage": [{ "kind": "timed", "start": 0, "end": 1 }, { "kind": "allDay", "start": 0, "end": 1 }],
        },
        "completedSince": "2026-11-02T11:00:00.000Z",
        "skipLanes": ["email-recent"],
        "maxPages": 20,
    }))
    .unwrap();
    assert_eq!(plan.pass, Pass::First);
    assert_eq!(plan.saved_lanes, 3);
    assert_eq!(plan.max_pages, Some(20));
    assert!(plan.lane_count() > 0);
}

#[test]
fn rejects_malformed_bodies() {
    for body in [
        json!({ "protocol": 1 }),
        json!({ "protocol": 1, "pass": "third" }),
        json!({ "protocol": 1, "pass": "first", "lanes": [{ "id": "Tasks" }] }),
        json!({ "protocol": 1, "pass": "first", "lanes": [{ "id": "tasks", "watermark": "yesterday" }] }),
        json!({ "protocol": 1, "pass": "first", "lanes": [{ "id": "tasks", "completedAt": 5 }] }),
        json!({ "protocol": 1, "pass": "first", "calendar": { "coverage": [] } }),
        json!({ "protocol": 1, "pass": "first", "calendar": { "timeZone": "UTC", "coverage": [{ "kind": "weekly", "start": 0, "end": 1 }] } }),
        json!({ "protocol": 1, "pass": "first", "completedSince": "soon" }),
        json!({ "protocol": 1, "pass": "first", "skipLanes": ["Tasks"] }),
        json!({ "protocol": 1, "pass": "first", "maxPages": -1 }),
    ] {
        let error = parse(body.clone()).unwrap_err();
        assert!(matches!(error, RequestError::Body(_)), "{body}: {error}");
    }
    let error =
        SyncPlan::from_json(b"not json", now(), MaterializedRange::around(now())).unwrap_err();
    assert!(matches!(error, RequestError::Body(_)));
}

#[test]
fn an_unknown_time_zone_plans_no_calendar_windows_and_the_rest_runs() {
    let plan = parse(json!({
        "protocol": 1, "pass": "first", "calendar": { "timeZone": "Mars/Olympus_Mons", "coverage": [] },
    }))
    .unwrap();
    assert!(plan.lanes.iter().any(|lane| lane.id.as_str() == "tasks"));
    assert!(
        !plan
            .lanes
            .iter()
            .any(|lane| lane.id.as_str().starts_with("calendar"))
    );
}

#[test]
fn rejects_duplicate_saved_lanes() {
    let error = parse(json!({
        "protocol": 1, "pass": "first", "lanes": [{ "id": "tasks" }, { "id": "tasks" }],
    }))
    .unwrap_err();
    assert!(matches!(error, RequestError::DuplicateLane(lane) if lane.as_str() == "tasks"));
}

#[test]
fn bounds_what_a_request_carries() {
    let lanes = (0..=MAX_SAVED_LANES)
        .map(|index| json!({ "id": format!("lane-{index}") }))
        .collect::<Vec<_>>();
    let error = parse(json!({ "protocol": 1, "pass": "first", "lanes": lanes })).unwrap_err();
    assert!(
        matches!(error, RequestError::TooManySavedLanes(count) if count == MAX_SAVED_LANES + 1)
    );

    let skipped = (0..=MAX_SAVED_LANES)
        .map(|index| format!("lane-{index}"))
        .collect::<Vec<_>>();
    let error = parse(json!({ "protocol": 1, "pass": "first", "skipLanes": skipped })).unwrap_err();
    assert!(matches!(error, RequestError::TooManySkippedLanes(_)));

    let coverage = (0..=MAX_COVERAGE_SPANS)
        .map(|index| json!({ "kind": "timed", "start": index, "end": index + 1 }))
        .collect::<Vec<_>>();
    let error = parse(json!({
        "protocol": 1, "pass": "first", "calendar": { "timeZone": "UTC", "coverage": coverage },
    }))
    .unwrap_err();
    assert!(matches!(error, RequestError::TooManyCoverageSpans(_)));
}

#[test]
fn refuses_a_body_without_a_protocol_or_outside_the_versions() {
    for (protocol, expected) in [
        (None, None),
        (Some(json!(0)), Some(0)),
        (Some(json!(2)), Some(2)),
    ] {
        let mut body = json!({ "pass": "first" });
        if let Some(protocol) = protocol {
            body["protocol"] = protocol;
        }
        let error = parse(body.clone()).unwrap_err();
        assert!(
            matches!(error, RequestError::UnsupportedProtocol(requested) if requested == expected),
            "{body}: {error}"
        );
    }
    let error = parse(json!({ "protocol": "1", "pass": "first" })).unwrap_err();
    assert!(matches!(error, RequestError::Body(_)));
}

#[test]
fn checks_the_protocol_before_the_rest_of_the_body() {
    let error =
        parse(json!({ "protocol": 2, "lanes": "a shape this server does not know" })).unwrap_err();
    assert!(matches!(error, RequestError::UnsupportedProtocol(Some(2))));
    assert_eq!(
        error.to_string(),
        "sync protocol 2 is not supported; this server speaks 1 to 1"
    );
}

#[test]
fn keeps_the_protocol_it_accepted() {
    let plan = parse(json!({ "protocol": 1, "pass": "second" })).unwrap();
    assert_eq!(plan.protocol, 1);
    assert_eq!(plan.pass, Pass::Second);
}
