use super::*;
use serde_json::json;

const TASKS_QUERY: &str = "query SoupBackfillSyncTasks($input: SoupInput!) { user { id soup(input: $input) { items { __typename id } nextCursor } } }";

#[test]
fn accepts_soup_and_calendar_lanes() {
    let body = json!({
        "lanes": [
            {
                "id": "tasks",
                "query": TASKS_QUERY,
                "operationName": "SoupBackfillSyncTasks",
                "variables": { "input": { "initial": { "limit": 500, "expand": false, "emailView": "ALL" } } },
                "paging": "soup",
                "maxItems": 1000
            },
            {
                "id": "calendar-0",
                "query": "query { user { id calendarOccurrences(input: $input) { nodes { id } hasNextPage endCursor } } }",
                "variables": { "input": { "start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z", "first": 500 } },
                "paging": "calendar"
            }
        ],
        "maxPages": 20
    });
    let plan = SyncPlan::from_json(body.to_string().as_bytes()).unwrap();
    assert_eq!(plan.lane_count(), 2);
    assert_eq!(plan.max_pages, Some(20));
    assert_eq!(plan.lanes[0].max_items, Some(1000));
    let LanePaging::Soup { carried } = &plan.lanes[0].paging else {
        panic!("tasks lane should page as soup");
    };
    assert_eq!(
        Value::Object(carried.clone()),
        json!({ "expand": false, "emailView": "ALL" })
    );
    assert!(matches!(plan.lanes[1].paging, LanePaging::Calendar { .. }));
}

#[test]
fn soup_continuation_input_carries_only_present_fields() {
    let body = json!({
        "lanes": [{
            "id": "email-recent",
            "query": TASKS_QUERY,
            "variables": { "input": { "continuation": { "cursor": "abc", "emailView": "ALL" } } },
            "paging": "soup"
        }]
    });
    let plan = SyncPlan::from_json(body.to_string().as_bytes()).unwrap();
    let LanePaging::Soup { carried } = &plan.lanes[0].paging else {
        panic!("lane should page as soup");
    };
    assert_eq!(
        Value::Object(carried.clone()),
        json!({ "emailView": "ALL" })
    );
}

#[test]
fn rejects_lane_ids_outside_the_pattern() {
    for id in ["", "Tasks", "tasks_all", "tasks all", &"a".repeat(65)] {
        let body = json!({
            "lanes": [{ "id": id, "query": TASKS_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
        });
        let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
        assert!(matches!(error, RequestError::Body(_)), "{id:?}: {error}");
    }
    let body = json!({
        "lanes": [{ "id": "a".repeat(64), "query": TASKS_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    });
    assert!(SyncPlan::from_json(body.to_string().as_bytes()).is_ok());
}

#[test]
fn rejects_duplicate_lane_ids() {
    let body = json!({
        "lanes": [
            { "id": "tasks", "query": TASKS_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" },
            { "id": "tasks", "query": TASKS_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" }
        ]
    });
    let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
    assert!(matches!(error, RequestError::DuplicateLane(lane) if lane.as_str() == "tasks"));
}

#[test]
fn rejects_more_than_thirty_two_lanes() {
    let lanes: Vec<Value> = (0..33)
        .map(|index| {
            json!({ "id": format!("lane-{index}"), "query": TASKS_QUERY, "variables": { "input": { "initial": {} } }, "paging": "soup" })
        })
        .collect();
    let error = SyncPlan::from_json(json!({ "lanes": lanes }).to_string().as_bytes()).unwrap_err();
    assert!(matches!(error, RequestError::TooManyLanes(33)));
}

#[test]
fn rejects_mutations_and_subscriptions() {
    for (query, expected) in [
        (
            "mutation M($input: SoupInput!) { touch(input: $input) }",
            OperationType::Mutation,
        ),
        (
            "subscription S($input: SoupInput!) { soupUpdates(input: $input) { id } }",
            OperationType::Subscription,
        ),
    ] {
        let body = json!({
            "lanes": [{ "id": "tasks", "query": query, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
        });
        let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
        assert!(
            matches!(error, RequestError::NotQuery { kind, .. } if kind == expected),
            "{query}: {error}"
        );
    }
}

#[test]
fn rejects_a_query_hidden_behind_another_operation_name() {
    let query = "query Q { user { id } } mutation M { touch }";
    let body = json!({
        "lanes": [{ "id": "tasks", "query": query, "operationName": "M", "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    });
    let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
    assert!(matches!(
        error,
        RequestError::NotQuery {
            kind: OperationType::Mutation,
            ..
        }
    ));
}

#[test]
fn rejects_unselected_operations() {
    for (query, operation_name) in [
        ("query Q { user { id } } query R { user { id } }", None),
        (TASKS_QUERY, Some("Other")),
        ("{ user { id } }", Some("Anonymous")),
    ] {
        let body = json!({
            "lanes": [{ "id": "tasks", "query": query, "operationName": operation_name, "variables": { "input": { "initial": {} } }, "paging": "soup" }]
        });
        let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
        assert!(
            matches!(error, RequestError::OperationNotSelected(_)),
            "{query}: {error}"
        );
    }
}

#[test]
fn rejects_unparsable_queries() {
    let body = json!({
        "lanes": [{ "id": "tasks", "query": "query { user { id }", "variables": { "input": { "initial": {} } }, "paging": "soup" }]
    });
    let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
    assert!(matches!(error, RequestError::QueryParse { .. }));
}

#[test]
fn rejects_lanes_without_a_pageable_input() {
    for (variables, paging) in [
        (json!({}), "soup"),
        (json!({ "input": "initial" }), "soup"),
        (json!({ "input": null }), "calendar"),
    ] {
        let body = json!({
            "lanes": [{ "id": "tasks", "query": TASKS_QUERY, "variables": variables, "paging": paging }]
        });
        let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
        assert!(matches!(error, RequestError::MissingInput(_)), "{error}");
    }
    for input in [
        json!({}),
        json!({ "initial": {}, "continuation": { "cursor": "abc" } }),
        json!({ "first": 20 }),
        json!({ "initial": 20 }),
    ] {
        let body = json!({
            "lanes": [{ "id": "tasks", "query": TASKS_QUERY, "variables": { "input": input }, "paging": "soup" }]
        });
        let error = SyncPlan::from_json(body.to_string().as_bytes()).unwrap_err();
        assert!(
            matches!(error, RequestError::InvalidSoupInput(_)),
            "{error}"
        );
    }
}

#[test]
fn rejects_malformed_bodies() {
    for body in [
        "not json".to_owned(),
        json!({}).to_string(),
        json!({ "lanes": [{ "id": "tasks", "query": TASKS_QUERY, "variables": [], "paging": "soup" }] })
            .to_string(),
        json!({ "lanes": [{ "id": "tasks", "query": TASKS_QUERY, "variables": { "input": { "initial": {} } }, "paging": "grouped" }] })
            .to_string(),
        json!({ "lanes": [], "maxPages": -1 }).to_string(),
    ] {
        let error = SyncPlan::from_json(body.as_bytes()).unwrap_err();
        assert!(matches!(error, RequestError::Body(_)), "{body}: {error}");
    }
}
