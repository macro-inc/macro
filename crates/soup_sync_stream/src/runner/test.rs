use super::*;
use crate::catalog::Pass;
use crate::lane::{LaneDraft, LaneKind, Paging};
use crate::turns::{PageTurn, PageTurns, StreamTurns};
use futures::StreamExt as _;
use serde_json::json;
use std::sync::{Arc, Mutex};

const PASS_STARTED_AT: &str = "2026-11-02T12:00:00.000Z";

/// Each page a [`ScriptedExecutor`] ran: its operation name and variables.
type Calls = Arc<Mutex<Vec<(Option<String>, Value)>>>;

/// Answers pages from a script and records what it was asked to run.
#[derive(Clone, Default)]
struct ScriptedExecutor {
    responses: Arc<Mutex<VecDeque<Result<Value, FakeError>>>>,
    calls: Calls,
}

#[derive(Debug, thiserror::Error)]
#[error("fake execution failure")]
struct FakeError;

impl ScriptedExecutor {
    fn new(responses: Vec<Result<Value, FakeError>>) -> Self {
        Self {
            responses: Arc::new(Mutex::new(responses.into())),
            calls: Arc::default(),
        }
    }

    fn calls(&self) -> Vec<(Option<String>, Value)> {
        self.calls.lock().unwrap().clone()
    }
}

impl PageExecutor for ScriptedExecutor {
    type Error = FakeError;
    type Turn = ();

    async fn turn(&self) {}

    async fn execute(&self, mut request: Request) -> Result<Value, FakeError> {
        assert!(
            request.parsed_query().is_ok(),
            "pages run with the lane's parsed document"
        );
        let variables = request.variables.into_value().into_json().unwrap();
        self.calls
            .lock()
            .unwrap()
            .push((request.operation_name, variables));
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Err(FakeError))
    }
}

const SOUP_QUERY: &str = "query SoupBackfillSyncTasks($input: SoupInput!, $withBody: Boolean) { user { id soup(input: $input) { items { __typename id } nextCursor } } }";
const CALENDAR_QUERY: &str = "query CalendarOccurrences($input: CalendarRangeInput!) { user { id calendarOccurrences(input: $input) { nodes { id } hasNextPage endCursor } } }";

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("expected an object literal, got {other}"),
    }
}

/// A plan of test lanes: `{ lanes: [{ id, query, operationName?, variables,
/// paging, maxItems?, itemsBefore?, resumable? }], maxPages? }`. Soup lanes
/// hydrate and resume unless told otherwise; calendar lanes never resume.
fn test_plan(body: Value) -> SyncPlan {
    let number = |value: &Value, field: &str| {
        value
            .get(field)
            .and_then(Value::as_u64)
            .map(|number| u32::try_from(number).unwrap())
    };
    let lanes = body["lanes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|lane| {
            let query: &'static str =
                Box::leak(lane["query"].as_str().unwrap().to_owned().into_boxed_str());
            let operation_name = match lane.get("operationName").and_then(Value::as_str) {
                Some(name) => Box::leak(name.to_owned().into_boxed_str()),
                None => operation_of(query),
            };
            let paging = match lane["paging"].as_str().unwrap() {
                "soup" => Paging::Soup,
                _ => Paging::Calendar,
            };
            LanePlan::new(LaneDraft {
                id: LaneId::try_from(lane["id"].as_str().unwrap().to_owned()).unwrap(),
                query,
                operation_name,
                variables: object(lane["variables"].clone()),
                paging,
                kind: match paging {
                    Paging::Soup => LaneKind::Hydrate,
                    Paging::Calendar => LaneKind::Calendar {
                        coverage: Vec::new(),
                    },
                },
                max_items: number(lane, "maxItems"),
                items_before: number(lane, "itemsBefore").unwrap_or(0),
                resumable: lane
                    .get("resumable")
                    .and_then(Value::as_bool)
                    .unwrap_or(paging == Paging::Soup),
                pass_started_at: PASS_STARTED_AT.to_owned(),
                coverage: None,
            })
            .unwrap()
        })
        .collect();
    SyncPlan {
        protocol: 1,
        pass: Pass::First,
        saved_lanes: 0,
        lanes,
        max_pages: number(&body, "maxPages"),
    }
}

/// The name of a test query's operation.
fn operation_of(query: &'static str) -> &'static str {
    let rest = query.trim_start().strip_prefix("query ").unwrap();
    &rest[..rest.find(['(', ' ', '{']).unwrap()]
}

/// The `resume` of a test lane's page.
fn resume(cursor: &str, items: u32) -> Option<Value> {
    Some(resume_checkpoint(cursor, items, PASS_STARTED_AT))
}

/// The stream's frames without its `lane` lines, which
/// `declares_each_lane_once_before_anything_else_of_it` covers.
async fn run(plan: SyncPlan, executor: impl PageExecutor) -> Vec<Frame> {
    frames(plan, executor)
        .filter(|frame| std::future::ready(!matches!(frame, Frame::Lane { .. })))
        .collect()
        .await
}

#[tokio::test]
async fn soup_lane_follows_cursors_until_none() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "id": "u", "soup": { "items": [{ "id": "1" }, { "id": "2" }], "nextCursor": "c1" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "id": "u", "soup": { "items": [{ "id": "3" }], "nextCursor": "c2" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "id": "u", "soup": { "items": [], "nextCursor": null } } } }),
        ),
    ]);
    let plan = test_plan(json!({
        "lanes": [{
            "id": "tasks",
            "query": SOUP_QUERY,
            "operationName": "SoupBackfillSyncTasks",
            "variables": { "withBody": false, "input": { "initial": { "limit": 2, "expand": false, "emailView": "ALL" } } },
            "paging": "soup"
        }]
    }));

    let frames = run(plan, executor.clone()).await;

    let lane = LaneId::try_from("tasks".to_owned()).unwrap();
    let first = object(
        json!({ "withBody": false, "input": { "initial": { "limit": 2, "expand": false, "emailView": "ALL" } } }),
    );
    let second = object(
        json!({ "withBody": false, "input": { "continuation": { "cursor": "c1", "expand": false, "emailView": "ALL" } } }),
    );
    let third = object(
        json!({ "withBody": false, "input": { "continuation": { "cursor": "c2", "expand": false, "emailView": "ALL" } } }),
    );
    assert_eq!(
        frames,
        vec![
            Frame::Page {
                lane: lane.clone(),
                page: 0,
                variables: first.clone(),
                response: json!({ "data": { "user": { "id": "u", "soup": { "items": [{ "id": "1" }, { "id": "2" }], "nextCursor": "c1" } } } }),
                items: 2,
                resume: resume("c1", 2),
            },
            Frame::Page {
                lane: lane.clone(),
                page: 1,
                variables: second.clone(),
                response: json!({ "data": { "user": { "id": "u", "soup": { "items": [{ "id": "3" }], "nextCursor": "c2" } } } }),
                items: 1,
                resume: resume("c2", 3),
            },
            Frame::Page {
                lane: lane.clone(),
                page: 2,
                variables: third.clone(),
                response: json!({ "data": { "user": { "id": "u", "soup": { "items": [], "nextCursor": null } } } }),
                items: 0,
                resume: None,
            },
            Frame::LaneDone {
                lane,
                pages: 3,
                items: 3,
                reason: LaneDoneReason::Complete,
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
    let name = Some("SoupBackfillSyncTasks".to_owned());
    assert_eq!(
        executor.calls(),
        vec![
            (name.clone(), Value::Object(first)),
            (name.clone(), Value::Object(second)),
            (name, Value::Object(third)),
        ]
    );
}

#[tokio::test]
async fn soup_lane_resumed_from_a_continuation_keeps_its_fields() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": "c9" } } } }),
        ),
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": null } } } })),
    ]);
    let plan = test_plan(json!({
        "lanes": [{
            "id": "email-recent",
            "query": SOUP_QUERY,
            "variables": { "input": { "continuation": { "cursor": "c8", "emailView": "ALL", "sortDirection": "ASC" } } },
            "paging": "soup"
        }]
    }));

    let _ = run(plan, executor.clone()).await;

    assert_eq!(
        executor.calls(),
        vec![
            (
                Some("SoupBackfillSyncTasks".to_owned()),
                json!({ "input": { "continuation": { "cursor": "c8", "emailView": "ALL", "sortDirection": "ASC" } } })
            ),
            (
                Some("SoupBackfillSyncTasks".to_owned()),
                json!({ "input": { "continuation": { "cursor": "c9", "emailView": "ALL", "sortDirection": "ASC" } } })
            ),
        ]
    );
}

#[tokio::test]
async fn calendar_lane_pages_with_after_and_rejects_a_repeated_cursor() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "calendarOccurrences": { "nodes": [{ "id": "o1" }], "hasNextPage": true, "endCursor": "k1" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "calendarOccurrences": { "nodes": [{ "id": "o2" }], "hasNextPage": true, "endCursor": "k1" } } } }),
        ),
    ]);
    let plan = test_plan(json!({
        "lanes": [
            {
                "id": "calendar-0",
                "query": CALENDAR_QUERY,
                "variables": { "input": { "start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z", "first": 1 } },
                "paging": "calendar"
            },
            {
                "id": "tasks-ids",
                "query": SOUP_QUERY,
                "variables": { "input": { "initial": {} } },
                "paging": "soup"
            }
        ]
    }));

    let frames = run(plan, executor.clone()).await;

    let lane = LaneId::try_from("calendar-0".to_owned()).unwrap();
    let after_k1 = object(
        json!({ "input": { "start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z", "first": 1, "after": "k1" } }),
    );
    assert_eq!(
        frames,
        vec![
            Frame::Page {
                lane: lane.clone(),
                page: 0,
                variables: object(
                    json!({ "input": { "start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z", "first": 1 } })
                ),
                response: json!({ "data": { "user": { "calendarOccurrences": { "nodes": [{ "id": "o1" }], "hasNextPage": true, "endCursor": "k1" } } } }),
                items: 1,
                resume: None,
            },
            Frame::Page {
                lane: lane.clone(),
                page: 1,
                variables: after_k1,
                response: json!({ "data": { "user": { "calendarOccurrences": { "nodes": [{ "id": "o2" }], "hasNextPage": true, "endCursor": "k1" } } } }),
                items: 1,
                resume: None,
            },
            Frame::LaneError {
                lane,
                message: "calendar page repeated a cursor".to_owned(),
            },
            Frame::LaneError {
                lane: LaneId::try_from("tasks-ids".to_owned()).unwrap(),
                message: "page could not be executed".to_owned(),
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
    assert_eq!(
        executor.calls().len(),
        3,
        "the next lane runs after the failure"
    );
}

#[tokio::test]
async fn calendar_lane_rejects_a_resumed_cursor_coming_back() {
    let executor = ScriptedExecutor::new(vec![Ok(
        json!({ "data": { "user": { "calendarOccurrences": { "nodes": [], "hasNextPage": true, "endCursor": "k4" } } } }),
    )]);
    let plan = test_plan(json!({
        "lanes": [{
            "id": "calendar-0",
            "query": CALENDAR_QUERY,
            "variables": { "input": { "start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z", "after": "k4" } },
            "paging": "calendar"
        }]
    }));

    let frames = run(plan, executor).await;

    assert!(matches!(
        &frames[1],
        Frame::LaneError { message, .. } if message == "calendar page repeated a cursor"
    ));
}

#[tokio::test]
async fn calendar_lane_completes_without_a_next_page_and_fails_without_an_end_cursor() {
    let complete = ScriptedExecutor::new(vec![Ok(
        json!({ "data": { "user": { "calendarOccurrences": { "nodes": [{ "id": "o1" }, { "id": "o2" }], "hasNextPage": false, "endCursor": "k1" } } } }),
    )]);
    let missing_cursor = ScriptedExecutor::new(vec![Ok(
        json!({ "data": { "user": { "calendarOccurrences": { "nodes": [], "hasNextPage": true, "endCursor": null } } } }),
    )]);
    let body = json!({
        "lanes": [{
            "id": "calendar-0",
            "query": CALENDAR_QUERY,
            "variables": { "input": { "start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z" } },
            "paging": "calendar"
        }]
    });

    let completed = run(test_plan(body.clone()), complete).await;
    let failed = run(test_plan(body.clone()), missing_cursor).await;

    let lane = LaneId::try_from("calendar-0".to_owned()).unwrap();
    assert!(matches!(
        &completed[0],
        Frame::Page {
            items: 2,
            resume: None,
            ..
        }
    ));
    assert_eq!(
        completed[1..],
        [
            Frame::LaneDone {
                lane: lane.clone(),
                pages: 1,
                items: 2,
                reason: LaneDoneReason::Complete,
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
    assert_eq!(
        failed[1..],
        [
            Frame::LaneError {
                lane,
                message: "calendar page has a next page but no endCursor".to_owned(),
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
}

#[tokio::test]
async fn max_items_stops_the_lane_and_the_next_lane_runs() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }, { "id": "2" }], "nextCursor": "c1" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "3" }, { "id": "4" }], "nextCursor": "c2" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "p1" }], "nextCursor": null } } } }),
        ),
    ]);
    let plan = test_plan(json!({
        "lanes": [
            { "id": "email-older", "query": SOUP_QUERY, "variables": { "input": { "initial": { "limit": 2 } } }, "paging": "soup", "maxItems": 3 },
            { "id": "task-projects", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }
        ]
    }));

    let frames = run(plan, executor.clone()).await;

    assert!(matches!(
        &frames[0],
        Frame::Page {
            page: 0,
            items: 2,
            resume: Some(_),
            ..
        }
    ));
    assert!(matches!(
        &frames[1],
        Frame::Page {
            page: 1,
            items: 2,
            resume: None,
            ..
        }
    ));
    assert_eq!(
        frames[2],
        Frame::LaneDone {
            lane: LaneId::try_from("email-older".to_owned()).unwrap(),
            pages: 2,
            items: 4,
            reason: LaneDoneReason::MaxItems,
        }
    );
    assert!(matches!(
        &frames[3],
        Frame::Page { lane, page: 0, .. } if lane.as_str() == "task-projects"
    ));
    assert_eq!(
        frames[4..],
        [
            Frame::LaneDone {
                lane: LaneId::try_from("task-projects".to_owned()).unwrap(),
                pages: 1,
                items: 1,
                reason: LaneDoneReason::Complete,
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
    assert_eq!(executor.calls().len(), 3);
}

#[tokio::test]
async fn max_pages_ends_the_stream_with_the_next_page_saved() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": null } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "2" }], "nextCursor": "c1" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "3" }], "nextCursor": null } } } }),
        ),
    ]);
    let plan = test_plan(json!({
        "lanes": [
            { "id": "crm-contacts", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" },
            { "id": "core-rest", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }
        ],
        "maxPages": 2
    }));

    let frames = run(plan, executor.clone()).await;

    assert_eq!(frames.len(), 4);
    assert!(matches!(&frames[1], Frame::LaneDone { lane, .. } if lane.as_str() == "crm-contacts"));
    assert!(matches!(
        &frames[2],
        Frame::Page { lane, resume: Some(next), .. }
            if lane.as_str() == "core-rest" && Some(next.clone()) == resume("c1", 1)
    ));
    assert_eq!(
        frames[3],
        Frame::End {
            reason: EndReason::MaxPages,
        }
    );
    assert_eq!(executor.calls().len(), 2);
}

#[tokio::test]
async fn max_pages_reached_on_the_last_lane_page_ends_complete() {
    let executor = ScriptedExecutor::new(vec![Ok(
        json!({ "data": { "user": { "soup": { "items": [], "nextCursor": null } } } }),
    )]);
    let plan = test_plan(json!({
        "lanes": [{ "id": "crm-contacts", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }],
        "maxPages": 1
    }));

    let frames = run(plan, executor).await;

    assert_eq!(
        frames.last(),
        Some(&Frame::End {
            reason: EndReason::Complete,
        })
    );
}

#[tokio::test]
async fn a_page_with_graphql_errors_fails_its_lane_and_the_next_lane_runs() {
    let executor = ScriptedExecutor::new(vec![
        Ok(json!({
            "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": "c1" } } },
            "errors": [{ "message": "boom", "path": ["user", "soup", "items", 0, "name"] }]
        })),
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "p1" }], "nextCursor": null } } } }),
        ),
    ]);
    let plan = test_plan(json!({
        "lanes": [
            { "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" },
            { "id": "task-projects", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }
        ]
    }));

    let frames = run(plan, executor.clone()).await;

    let lane = LaneId::try_from("tasks".to_owned()).unwrap();
    let projects = LaneId::try_from("task-projects".to_owned()).unwrap();
    assert_eq!(
        frames,
        vec![
            Frame::Page {
                lane: lane.clone(),
                page: 0,
                variables: object(json!({ "input": { "initial": {} } })),
                response: json!({
                    "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": "c1" } } },
                    "errors": [{ "message": "boom", "path": ["user", "soup", "items", 0, "name"] }]
                }),
                items: 1,
                resume: None,
            },
            Frame::LaneError {
                lane,
                message: "page response has GraphQL errors".to_owned(),
            },
            Frame::Page {
                lane: projects.clone(),
                page: 0,
                variables: object(json!({ "input": { "initial": {} } })),
                response: json!({ "data": { "user": { "soup": { "items": [{ "id": "p1" }], "nextCursor": null } } } }),
                items: 1,
                resume: None,
            },
            Frame::LaneDone {
                lane: projects,
                pages: 1,
                items: 1,
                reason: LaneDoneReason::Complete,
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
    assert_eq!(
        executor.calls().len(),
        2,
        "the next lane runs after the failure"
    );
}

#[tokio::test]
async fn a_page_without_paging_fields_fails_its_lane() {
    let executor = ScriptedExecutor::new(vec![Ok(json!({ "data": null }))]);
    let plan = test_plan(json!({
        "lanes": [{ "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    }));

    let frames = run(plan, executor).await;

    assert!(matches!(
        &frames[0],
        Frame::Page {
            items: 0,
            resume: None,
            ..
        }
    ));
    assert_eq!(
        frames[1..],
        [
            Frame::LaneError {
                lane: LaneId::try_from("tasks".to_owned()).unwrap(),
                message: "page response lacks data.user.soup.items".to_owned(),
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
}

#[tokio::test]
async fn an_execution_failure_sends_no_page() {
    let executor = ScriptedExecutor::new(vec![Err(FakeError)]);
    let plan = test_plan(json!({
        "lanes": [{ "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    }));

    let frames = run(plan, executor).await;

    assert_eq!(
        frames,
        vec![
            Frame::LaneError {
                lane: LaneId::try_from("tasks".to_owned()).unwrap(),
                message: "page could not be executed".to_owned(),
            },
            Frame::End {
                reason: EndReason::Complete,
            },
        ]
    );
}

/// Answers every page with `page` after `delays` in turn (the last delay
/// repeats), on tokio's clock.
struct DelayedExecutor {
    delays: Mutex<VecDeque<Duration>>,
    page: Value,
}

impl PageExecutor for DelayedExecutor {
    type Error = FakeError;
    type Turn = ();

    async fn turn(&self) {}

    async fn execute(&self, _request: Request) -> Result<Value, FakeError> {
        let delay = {
            let mut delays = self.delays.lock().unwrap();
            if delays.len() > 1 {
                delays.pop_front().unwrap()
            } else {
                delays[0]
            }
        };
        tokio::time::sleep(delay).await;
        Ok(self.page.clone())
    }
}

#[tokio::test(start_paused = true)]
async fn a_page_past_its_timeout_fails_its_lane_and_the_next_lane_runs() {
    let executor = DelayedExecutor {
        delays: Mutex::new(vec![PAGE_TIMEOUT + Duration::from_secs(1), Duration::ZERO].into()),
        page: json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": null } } } }),
    };
    let plan = test_plan(json!({
        "lanes": [
            { "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" },
            { "id": "channels", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }
        ]
    }));

    let frames = run(plan, executor).await;

    assert_eq!(
        frames[0],
        Frame::LaneError {
            lane: LaneId::try_from("tasks".to_owned()).unwrap(),
            message: "page timed out".to_owned(),
        }
    );
    assert!(matches!(&frames[1], Frame::Page { lane, .. } if lane.as_str() == "channels"));
    assert!(matches!(&frames[2], Frame::LaneDone { lane, .. } if lane.as_str() == "channels"));
    assert_eq!(
        frames[3],
        Frame::End {
            reason: EndReason::Complete,
        }
    );
}

#[tokio::test(start_paused = true)]
async fn a_stream_past_its_deadline_ends_with_the_resume_point_saved() {
    // Each page takes 40 s (under the page timeout): pages 0 to 7 start
    // before the 5-minute deadline, and page 8 would start after it.
    let executor = DelayedExecutor {
        delays: Mutex::new(vec![Duration::from_secs(40)].into()),
        page: json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": "next" } } } }),
    };
    let plan = test_plan(json!({
        "lanes": [{ "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    }));

    let frames = run(plan, executor).await;

    assert_eq!(frames.len(), 9);
    assert!(matches!(
        &frames[7],
        Frame::Page { page: 7, resume: Some(next), .. }
            if Some(next.clone()) == resume("next", 8)
    ));
    assert_eq!(
        frames[8],
        Frame::End {
            reason: EndReason::Deadline,
        }
    );
}

/// Answers every page with an empty last page, once it gets its turn.
struct QueuedExecutor {
    turns: StreamTurns<&'static str>,
}

impl PageExecutor for QueuedExecutor {
    type Error = FakeError;
    type Turn = PageTurn<&'static str>;

    fn turn(&self) -> impl Future<Output = Self::Turn> + Send {
        self.turns.next()
    }

    async fn execute(&self, _request: Request) -> Result<Value, FakeError> {
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": null } } } }))
    }
}

fn one_lane_plan() -> SyncPlan {
    test_plan(json!({
        "lanes": [{ "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    }))
}

#[tokio::test(start_paused = true)]
async fn a_stream_sends_waiting_until_its_turn_and_the_wait_is_not_page_time() {
    let turns = PageTurns::new(1);
    let running = turns.stream("other").next().await;
    let executor = QueuedExecutor {
        turns: turns.stream("queued"),
    };

    let mut frames = Box::pin(frames(one_lane_plan(), executor));

    // Six intervals: longer than a page may run.
    for _ in 0..6 {
        assert_eq!(frames.next().await, Some(Frame::Waiting));
    }
    drop(running);
    assert!(matches!(frames.next().await, Some(Frame::Lane { .. })));
    assert!(matches!(
        frames.next().await,
        Some(Frame::Page { page: 0, .. })
    ));
    assert!(matches!(frames.next().await, Some(Frame::LaneDone { .. })));
}

#[tokio::test(start_paused = true)]
async fn a_stream_still_waiting_at_its_deadline_ends_with_deadline() {
    let turns = PageTurns::new(1);
    let _running = turns.stream("other").next().await;
    let executor = QueuedExecutor {
        turns: turns.stream("queued"),
    };

    let mut frames = run(one_lane_plan(), executor).await;

    assert_eq!(
        frames.pop(),
        Some(Frame::End {
            reason: EndReason::Deadline,
        })
    );
    assert_eq!(frames.len(), 30);
    assert!(frames.iter().all(|frame| *frame == Frame::Waiting));
}

#[tokio::test]
async fn a_request_without_lanes_ends_complete() {
    let plan = test_plan(json!({ "lanes": [] }));

    let frames = run(plan, ScriptedExecutor::default()).await;

    assert_eq!(
        frames,
        vec![Frame::End {
            reason: EndReason::Complete,
        }]
    );
}

#[tokio::test]
async fn pages_run_only_as_the_stream_is_read_and_stop_when_it_is_dropped() {
    let executor = ScriptedExecutor::new(vec![
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": "c1" } } } })),
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": "c2" } } } })),
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": "c3" } } } })),
    ]);
    let plan = test_plan(json!({
        "lanes": [{ "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    }));

    let mut lines = Box::pin(ndjson_stream(plan, executor.clone()));
    assert_eq!(
        executor.calls().len(),
        0,
        "nothing runs before the first read"
    );
    // The lane line, then its first page, both from the first page's run.
    lines.next().await.unwrap();
    assert_eq!(executor.calls().len(), 1);
    lines.next().await.unwrap();
    assert_eq!(executor.calls().len(), 1);
    lines.next().await.unwrap();
    assert_eq!(executor.calls().len(), 2);
    drop(lines);

    assert_eq!(executor.calls().len(), 2);
    assert_eq!(
        Arc::strong_count(&executor.calls),
        1,
        "dropping the stream drops its executor"
    );
}

#[tokio::test]
async fn ndjson_stream_writes_one_line_per_frame() {
    let executor = ScriptedExecutor::new(vec![Ok(
        json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": null } } } }),
    )]);
    let plan = test_plan(json!({
        "lanes": [{ "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    }));

    let lines: Vec<Bytes> = ndjson_stream(plan, executor).collect().await;

    let text: Vec<String> = lines
        .iter()
        .map(|line| String::from_utf8(line.to_vec()).unwrap())
        .collect();
    assert_eq!(
        text[0],
        format!(
            "{{\"type\":\"lane\",\"lane\":\"tasks\",\"query\":{},\"operationName\":\"SoupBackfillSyncTasks\",\"paging\":\"soup\",\"kind\":{{\"kind\":\"hydrate\"}},\"passStartedAt\":\"{PASS_STARTED_AT}\"}}\n",
            Value::String(SOUP_QUERY.to_owned())
        )
    );
    assert_eq!(
        text[1..],
        [
            "{\"type\":\"page\",\"lane\":\"tasks\",\"page\":0,\"variables\":{\"input\":{\"initial\":{}}},\"response\":{\"data\":{\"user\":{\"soup\":{\"items\":[{\"id\":\"1\"}],\"nextCursor\":null}}}},\"items\":1,\"resume\":null}\n",
            "{\"type\":\"laneDone\",\"lane\":\"tasks\",\"pages\":1,\"items\":1,\"reason\":\"complete\"}\n",
            "{\"type\":\"end\",\"reason\":\"complete\"}\n",
        ]
    );
}

#[tokio::test]
async fn streams_keep_returning_none_when_polled_after_the_end() {
    // HTTP bodies can be polled again after they end (the gzip response
    // layer's reader does); a bare unfold panics there.
    let plan = || test_plan(json!({ "lanes": [] }));

    let mut lines = Box::pin(ndjson_stream(plan(), ScriptedExecutor::default()));
    assert!(lines.next().await.is_some(), "the end line");
    assert!(lines.next().await.is_none());
    assert!(lines.next().await.is_none());

    let mut frames = Box::pin(frames(plan(), ScriptedExecutor::default()));
    assert!(frames.next().await.is_some());
    assert!(frames.next().await.is_none());
    assert!(frames.next().await.is_none());
}

#[tokio::test]
async fn declares_each_lane_once_before_anything_else_of_it() {
    let executor = ScriptedExecutor::new(vec![
        Err(FakeError),
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": "c1" } } } })),
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": null } } } })),
    ]);
    let plan = test_plan(json!({
        "lanes": [
            { "id": "tasks", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" },
            { "id": "channels", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" },
            { "id": "never-reached", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }
        ],
        "maxPages": 2
    }));

    let frames: Vec<Frame> = frames(plan, executor).collect().await;

    let kinds = frames
        .iter()
        .map(|frame| match frame {
            Frame::Lane { lane, .. } => format!("lane {lane}"),
            Frame::Page { lane, page, .. } => format!("page {lane} {page}"),
            Frame::LaneDone { lane, .. } => format!("done {lane}"),
            Frame::LaneError { lane, .. } => format!("error {lane}"),
            Frame::Waiting => "waiting".to_owned(),
            Frame::End { reason } => format!("end {}", <&'static str>::from(*reason)),
        })
        .collect::<Vec<_>>();
    // A lane that fails at once is still declared; one the stream never
    // reaches is not.
    assert_eq!(
        kinds,
        [
            "lane tasks",
            "error tasks",
            "lane channels",
            "page channels 0",
            "page channels 1",
            "done channels",
            "end maxPages",
        ]
    );
    assert_eq!(
        frames[0],
        Frame::Lane {
            lane: LaneId::try_from("tasks".to_owned()).unwrap(),
            query: SOUP_QUERY.to_owned(),
            operation_name: "SoupBackfillSyncTasks".to_owned(),
            paging: Paging::Soup,
            kind: LaneKind::Hydrate,
            pass_started_at: PASS_STARTED_AT.to_owned(),
            coverage: None,
        }
    );
}

#[tokio::test]
async fn max_items_counts_what_earlier_streams_of_the_pass_sent() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }, { "id": "2" }], "nextCursor": "c1" } } } }),
        ),
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "3" }], "nextCursor": "c2" } } } }),
        ),
    ]);
    let plan = test_plan(json!({
        "lanes": [{
            "id": "documents-recent",
            "query": SOUP_QUERY,
            "variables": { "input": { "continuation": { "cursor": "c0" } } },
            "paging": "soup",
            "maxItems": 1000,
            "itemsBefore": 997
        }]
    }));

    let frames = run(plan, executor.clone()).await;

    assert!(
        matches!(&frames[0], Frame::Page { resume: checkpoint, .. } if *checkpoint == resume("c1", 999))
    );
    assert!(matches!(&frames[1], Frame::Page { resume: None, .. }));
    assert_eq!(
        frames[2],
        Frame::LaneDone {
            lane: LaneId::try_from("documents-recent".to_owned()).unwrap(),
            pages: 2,
            items: 3,
            reason: LaneDoneReason::MaxItems,
        }
    );
    assert_eq!(executor.calls().len(), 2);
}

#[tokio::test]
async fn a_lane_that_starts_over_every_run_sends_no_checkpoint() {
    let executor = ScriptedExecutor::new(vec![
        Ok(
            json!({ "data": { "user": { "soup": { "items": [{ "id": "1" }], "nextCursor": "c1" } } } }),
        ),
        Ok(json!({ "data": { "user": { "soup": { "items": [], "nextCursor": null } } } })),
    ]);
    let plan = test_plan(json!({
        "lanes": [{ "id": "contacts", "query": SOUP_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup", "resumable": false }]
    }));

    let frames = run(plan, executor).await;

    assert!(matches!(
        &frames[0],
        Frame::Page {
            page: 0,
            resume: None,
            ..
        }
    ));
    assert!(matches!(&frames[2], Frame::LaneDone { .. }));
}

#[test]
fn the_encoding_fallback_matches_an_end_error_frame() {
    assert_eq!(
        Frame::End {
            reason: EndReason::Error,
        }
        .to_line()
        .unwrap()
        .as_ref(),
        END_ERROR_LINE
    );
}
