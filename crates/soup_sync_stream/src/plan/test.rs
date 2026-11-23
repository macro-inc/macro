use crate::lane::{LaneKind, LanePlan};
use crate::request::{MAX_LANES, SyncPlan};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

const NOW: &str = "2026-11-02T12:00:00.000Z";
const RUN_STARTED: &str = "2026-11-02T11:00:00.000Z";

fn now() -> DateTime<Utc> {
    NOW.parse().unwrap()
}

fn plan(body: Value) -> Vec<LanePlan> {
    SyncPlan::from_json(body.to_string().as_bytes(), now())
        .unwrap()
        .lanes
}

fn ids(lanes: &[LanePlan]) -> Vec<&str> {
    lanes.iter().map(|lane| lane.id.as_str()).collect()
}

fn lane<'a>(lanes: &'a [LanePlan], id: &str) -> &'a LanePlan {
    lanes
        .iter()
        .find(|lane| lane.id.as_str() == id)
        .unwrap_or_else(|| panic!("no lane {id}"))
}

fn first_pass(saved: Value) -> Vec<LanePlan> {
    plan(json!({ "protocol": 1, "pass": "first", "lanes": saved }))
}

#[test]
fn resumes_an_unfinished_pass_from_its_checkpoint() {
    let lanes = first_pass(json!([{
        "id": "documents-recent",
        "resume": { "cursor": "c9", "items": 600, "passStartedAt": "2026-11-01T08:00:00Z" },
        "watermark": "2026-10-01T00:00:00.000Z",
        "completedAt": "2026-10-01T00:10:00.000Z",
    }]));
    let documents = lane(&lanes, "documents-recent");
    assert_eq!(
        documents.variables["input"],
        json!({ "continuation": { "cursor": "c9", "expand": true, "emailView": "ALL" } })
    );
    // The cap counts the whole pass: 400 more items in this stream.
    assert_eq!(documents.max_items, Some(1_000));
    assert_eq!(documents.items_before, 600);
    assert_eq!(documents.pass_started_at, "2026-11-01T08:00:00.000Z");
}

#[test]
fn starts_a_lane_fresh_without_a_usable_checkpoint_or_watermark() {
    for saved in [
        json!({ "id": "tasks" }),
        json!({ "id": "tasks", "completedAt": "2026-10-01T00:10:00.000Z" }),
        json!({ "id": "tasks", "resume": { "cursor": 7 } }),
        json!({ "id": "tasks", "resume": "c1" }),
    ] {
        let lanes = first_pass(json!([saved]));
        let tasks = lane(&lanes, "tasks");
        assert!(tasks.variables["input"]["initial"].is_object(), "{saved}");
        assert_eq!(tasks.items_before, 0);
        assert_eq!(tasks.pass_started_at, NOW);
    }
}

#[test]
fn starts_membership_and_restart_on_run_lanes_fresh_whatever_they_saved() {
    let saved = ["tasks-ids", "channels", "email-shared"].map(|id| {
        json!({
            "id": id,
            "resume": { "cursor": "c1", "items": 5, "passStartedAt": RUN_STARTED },
            "watermark": "2026-10-01T00:00:00.000Z",
            "completedAt": "2026-10-01T00:10:00.000Z",
        })
    });
    let lanes = first_pass(json!(saved));
    for id in ["tasks-ids", "channels", "email-shared"] {
        let planned = lane(&lanes, id);
        let input = &planned.variables["input"]["initial"];
        assert!(input.is_object(), "{id}");
        assert!(
            !input.to_string().contains("2026-10-01"),
            "{id} is not narrowed"
        );
        assert!(!planned.resumable, "{id}");
    }
    assert_eq!(
        lane(&lanes, "tasks-ids").kind,
        LaneKind::Membership {
            scopes: vec!["tasks".to_owned().try_into().unwrap()]
        }
    );
}

#[test]
fn leaves_out_lanes_completed_since_the_run_started() {
    let lanes = plan(json!({
        "protocol": 1,
        "pass": "first",
        "completedSince": RUN_STARTED,
        "lanes": [
            { "id": "tasks", "completedAt": "2026-11-02T11:30:00.000Z", "watermark": RUN_STARTED },
            { "id": "task-projects", "completedAt": "2026-11-02T11:30:00.000Z" },
            // Completed before the run: caught up again.
            { "id": "channels", "completedAt": "2026-11-02T10:00:00.000Z" },
            // Completed, then started another pass during the run.
            {
                "id": "documents-recent",
                "completedAt": "2026-11-02T11:30:00.000Z",
                "resume": { "cursor": "c1", "items": 5, "passStartedAt": RUN_STARTED },
            },
        ],
    }));
    let ids = ids(&lanes);
    assert!(!ids.contains(&"tasks"));
    assert!(!ids.contains(&"task-projects"));
    assert!(ids.contains(&"channels"));
    assert!(ids.contains(&"documents-recent"));
}

#[test]
fn leaves_out_the_skipped_lanes_and_keeps_the_rest_in_order() {
    let all = ids(&plan(json!({ "protocol": 1, "pass": "second" })))
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let lanes = plan(json!({
        "protocol": 1,
        "pass": "second",
        "skipLanes": ["crm-contacts", "email-older", "no-such-lane"],
    }));
    let expected = all
        .iter()
        .filter(|id| *id != "crm-contacts" && *id != "email-older")
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(ids(&lanes), expected);
}

#[test]
fn plans_calendar_windows_only_when_asked() {
    let without = plan(json!({ "protocol": 1, "pass": "first" }));
    assert!(!ids(&without).iter().any(|id| id.starts_with("calendar")));
    let with = plan(json!({
        "protocol": 1,
        "pass": "first",
        "calendar": { "timeZone": "UTC", "coverage": [] },
    }));
    let windows = ids(&with)
        .into_iter()
        .filter(|id| id.starts_with("calendar-near-"))
        .collect::<Vec<_>>();
    // This month, then two each way.
    assert_eq!(
        windows,
        [
            "calendar-near-0",
            "calendar-near-1",
            "calendar-near-2",
            "calendar-near-3",
            "calendar-near-4"
        ]
    );
    // Calendar windows run after the recent documents, before the ID lanes.
    let order = ids(&with);
    let position = |id: &str| order.iter().position(|lane| *lane == id).unwrap();
    assert!(position("documents-recent") < position("calendar-near-0"));
    assert!(position("calendar-near-4") < position("tasks-ids"));
    let november = lane(&with, "calendar-near-0");
    assert_eq!(
        november.variables["input"],
        json!({
            "start": "2026-11-01T00:00:00.000Z",
            "end": "2026-12-01T00:00:00.000Z",
            "startDate": "2026-11-01",
            "endDate": "2026-12-01",
            "first": 2000,
        })
    );
    assert!(!november.resumable);
    assert_eq!(november.pass_started_at, NOW);
}

#[test]
fn caps_a_stream_at_the_lane_limit_by_dropping_the_farthest_windows() {
    let lanes = plan(json!({
        "protocol": 1,
        "pass": "second",
        "calendar": { "timeZone": "UTC", "coverage": [] },
    }));
    assert_eq!(lanes.len(), MAX_LANES);
    let soup = lanes
        .iter()
        .filter(|lane| !lane.id.as_str().starts_with("calendar"))
        .count();
    let windows = ids(&lanes)
        .into_iter()
        .filter(|id| id.starts_with("calendar-far-"))
        .collect::<Vec<_>>();
    assert_eq!(windows.len(), MAX_LANES - soup);
    // Nearest first: this month, next month, last month.
    assert_eq!(
        lane(&lanes, "calendar-far-1").variables["input"]["startDate"],
        "2026-12-01"
    );
    assert_eq!(
        lane(&lanes, "calendar-far-2").variables["input"]["startDate"],
        "2026-10-01"
    );
}

#[test]
fn leaves_out_calendar_months_the_cache_already_holds() {
    // November 2026 in UTC, both kinds.
    let november = json!([
        { "kind": "timed", "start": 1_793_491_200_000_i64, "end": 1_796_083_200_000_i64 },
        { "kind": "allDay", "start": 20_758, "end": 20_788 },
    ]);
    let lanes = plan(json!({
        "protocol": 1,
        "pass": "first",
        "calendar": { "timeZone": "UTC", "coverage": november },
    }));
    let starts = lanes
        .iter()
        .filter(|lane| lane.id.as_str().starts_with("calendar-near-"))
        .map(|lane| lane.variables["input"]["startDate"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        starts,
        ["2026-12-01", "2026-10-01", "2027-01-01", "2026-09-01"]
    );
}
