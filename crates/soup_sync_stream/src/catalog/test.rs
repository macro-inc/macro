use crate::calendar::MaterializedRange;
use crate::catalog::{LANE_QUERIES, LaneQuery};
use crate::lane::{LaneKind, LanePlan};
use crate::request::SyncPlan;
use apollo_compiler::{
    ExecutableDocument, Schema, request::coerce_variable_values, response::JsonMap,
};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

/// What each lane runs at [`now`]: its first input, and its input once it
/// completed with the watermark 2026-10-01 (`updatedSince`). Update it with
/// the lane.
const EXPECTED_LANES: &str = include_str!("test/expected_lanes.json");
const WATERMARK: &str = "2026-10-01T00:00:00.000Z";
const SCHEMA: &str = include_str!("../../../../static_assets/schema.graphql");

fn now() -> DateTime<Utc> {
    "2026-11-02T12:00:00Z".parse().unwrap()
}

fn plan(body: Value) -> SyncPlan {
    SyncPlan::from_json(
        crate::test_support::with_client_queries(body)
            .to_string()
            .as_bytes(),
        now(),
        MaterializedRange::around(now()),
    )
    .unwrap()
}

fn initial(lane: &LanePlan) -> &Value {
    &lane.variables["input"]["initial"]
}

fn expected(pass: &str) -> Vec<Value> {
    let lanes: Value = serde_json::from_str(EXPECTED_LANES).unwrap();
    lanes[pass]
        .as_array()
        .unwrap()
        .iter()
        .filter(|lane| lane.get("id").is_some())
        .cloned()
        .collect()
}

#[test]
fn every_lane_runs_its_expected_query_and_first_input() {
    for pass in ["first", "second"] {
        let plan = plan(json!({ "protocol": 1, "pass": pass }));
        let expected = expected(pass);
        let ids = plan
            .lanes
            .iter()
            .map(|lane| lane.id.as_str())
            .collect::<Vec<_>>();
        let expected_ids = expected
            .iter()
            .map(|lane| lane["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, expected_ids, "{pass} pass order");
        for (lane, expected) in plan.lanes.iter().zip(&expected) {
            let id = lane.id.as_str();
            assert_eq!(lane.operation_name, expected["operationName"], "{id}");
            assert_eq!(initial(lane), &expected["input"], "{id}");
            assert_eq!(
                serde_json::to_value(&lane.kind).unwrap(),
                expected["kind"],
                "{id}"
            );
            assert_eq!(
                lane.max_items.map(u64::from),
                expected["maxItems"].as_u64(),
                "{id}"
            );
            let restart = expected["restartOnRun"].as_bool().unwrap();
            assert_eq!(
                lane.resumable,
                !restart && lane.kind == LaneKind::Hydrate,
                "{id}"
            );
            assert_eq!(lane.pass_started_at, "2026-11-02T12:00:00.000Z", "{id}");
        }
    }
}

#[test]
fn a_completed_lane_catches_up_from_its_watermark() {
    for pass in ["first", "second"] {
        let expected = expected(pass);
        let saved = expected
            .iter()
            .map(|lane| json!({ "id": lane["id"], "completedAt": "2026-11-01T00:00:00.000Z", "watermark": WATERMARK }))
            .collect::<Vec<_>>();
        let plan = plan(json!({ "protocol": 1, "pass": pass, "lanes": saved }));
        for (lane, expected) in plan.lanes.iter().zip(&expected) {
            let caught_up = lane.resumable;
            let want = if caught_up {
                &expected["updatedSince"]
            } else {
                &expected["input"]
            };
            assert_eq!(initial(lane), want, "{}", lane.id);
        }
    }
}

#[test]
fn minimal_lanes_select_the_fields_local_filtering_needs() {
    let plan = plan(json!({ "protocol": 1, "pass": "first" }));
    for id in ["tasks", "documents-recent"] {
        let lane = plan
            .lanes
            .iter()
            .find(|lane| lane.id.as_str() == id)
            .unwrap();
        let query = lane.query.split_whitespace().collect::<Vec<_>>().join(" ");
        for field in [
            "cacheProjection",
            "name",
            "ownerId",
            "fileType",
            "projectId",
            "createdAt",
            "updatedAt",
            "viewedAt",
            "deletedAt",
            "isFavorited",
            "subType { __typename ... on GraphqlTaskSubType { isCompleted } }",
            "properties { id propertyDefinitionId value { ...SoupPropertyValueFields } }",
            "notifications { __typename id entityId entityType state }",
            "fragment SoupPropertyValueFields on GraphqlPropertyValue",
        ] {
            assert!(query.contains(field), "{id} selects {field}");
        }
        // The cache refuses this lane's pages when their rows are incomplete.
        assert!(lane_query(lane).complete_projections, "{id}");
    }
}

/// Fresh, resumed and caught-up lanes of both passes, calendar windows
/// included.
fn every_planned_lane() -> Vec<LanePlan> {
    let mut lanes = Vec::new();
    for pass in ["first", "second"] {
        let calendar = json!({ "timeZone": "America/New_York", "coverage": [] });
        lanes.extend(plan(json!({ "protocol": 1, "pass": pass, "calendar": calendar })).lanes);
        let saved = expected(pass)
            .iter()
            .map(|lane| {
                json!({
                    "id": lane["id"],
                    "resume": { "cursor": "c1", "items": 10, "passStartedAt": "2026-11-01T00:00:00.000Z" },
                })
            })
            .collect::<Vec<_>>();
        lanes.extend(plan(json!({ "protocol": 1, "pass": pass, "lanes": saved })).lanes);
        let saved = expected(pass)
            .iter()
            .map(|lane| json!({ "id": lane["id"], "completedAt": WATERMARK, "watermark": WATERMARK }))
            .collect::<Vec<_>>();
        lanes.extend(plan(json!({ "protocol": 1, "pass": pass, "lanes": saved })).lanes);
    }
    lanes
}

#[test]
fn queries_and_variables_are_valid_against_the_server_schema() {
    let schema = Schema::parse_and_validate(SCHEMA, "schema.graphql").unwrap();
    let lanes = every_planned_lane();
    assert!(
        lanes
            .iter()
            .any(|lane| lane.id.as_str().starts_with("calendar-far-"))
    );
    for lane in &lanes {
        let id = lane.id.as_str();
        let document =
            ExecutableDocument::parse_and_validate(&schema, &*lane.query, "lane.graphql")
                .unwrap_or_else(|errors| panic!("{id}: {errors}"));
        let operation = document
            .operations
            .get(Some(lane.operation_name))
            .unwrap_or_else(|_| panic!("{id} has its operation"));
        let mut pages = vec![lane.variables.clone()];
        // The page after the first, as the lane loop continues it.
        let mut next = lane.variables.clone();
        match &lane.kind {
            LaneKind::Calendar { .. } => {
                next["input"]["after"] = json!("cursor");
            }
            LaneKind::Hydrate | LaneKind::Membership { .. } => {
                let mut continuation = json!({ "cursor": "cursor" });
                for field in ["expand", "emailView", "sortDirection"] {
                    if let Some(value) = initial(lane).get(field) {
                        continuation[field] = value.clone();
                    }
                }
                next.insert("input".to_owned(), json!({ "continuation": continuation }));
            }
        }
        pages.push(next);
        for variables in pages {
            let values: JsonMap = serde_json::from_value(Value::Object(variables)).unwrap();
            coerce_variable_values(&schema, operation, &values)
                .unwrap_or_else(|error| panic!("{id} variables: {error:?}"));
        }
    }
}

#[test]
fn queries_carry_no_client_only_directives() {
    for lane in every_planned_lane() {
        assert!(!lane.query.contains('@'), "{}", lane.id);
    }
}

fn lane_query(lane: &LanePlan) -> &'static LaneQuery {
    LANE_QUERIES
        .iter()
        .find(|query| query.operation == lane.operation_name)
        .unwrap_or_else(|| panic!("{} runs a query missing from LANE_QUERIES", lane.id))
}

#[test]
fn every_lane_runs_a_listed_query() {
    for lane in every_planned_lane() {
        lane_query(&lane);
    }
}

#[test]
fn the_web_app_sends_every_lane_query() {
    let queries = crate::test_support::client_queries();
    for query in LANE_QUERIES {
        assert!(
            queries.get(query.operation).is_some(),
            "the web app sends no {} document",
            query.operation
        );
    }
}
