use super::*;
use serde_json::json;

const QUERY: &str = "query Tasks($input: SoupInput!) { user { id soup(input: $input) { items { id } nextCursor } } }";

fn draft(query: &'static str, operation_name: &'static str, input: Value) -> LaneDraft {
    LaneDraft {
        id: LaneId::try_from("tasks".to_owned()).unwrap(),
        query,
        operation_name,
        variables: Map::from_iter([(INPUT_VARIABLE.to_owned(), input)]),
        paging: Paging::Soup,
        kind: LaneKind::Hydrate,
        max_items: None,
        items_before: 0,
        resumable: true,
        pass_started_at: "2026-11-02T12:00:00.000Z".to_owned(),
        coverage: None,
    }
}

#[test]
fn lane_ids_are_lowercase_digits_and_dashes() {
    for valid in ["tasks", "calendar-near-0", &"a".repeat(64)] {
        assert!(LaneId::try_from(valid.to_owned()).is_ok(), "{valid}");
    }
    for invalid in ["", "Tasks", "tasks_ids", "tâches", &"a".repeat(65)] {
        assert!(LaneId::try_from(invalid.to_owned()).is_err(), "{invalid}");
    }
}

#[test]
fn a_soup_lane_continues_with_the_first_input_s_view_fields() {
    let plan = LanePlan::new(draft(
        QUERY,
        "Tasks",
        json!({ "initial": { "limit": 2, "expand": true, "emailView": "ALL", "filters": {} } }),
    ))
    .unwrap();
    let LanePaging::Soup { carried } = plan.paging else {
        panic!("soup paging");
    };
    assert_eq!(
        Value::Object(carried),
        json!({ "expand": true, "emailView": "ALL" })
    );
}

#[test]
fn a_lane_that_cannot_run_is_refused() {
    for (query, operation, input) in [
        ("query {", "Tasks", json!({ "initial": {} })),
        (QUERY, "Other", json!({ "initial": {} })),
        (
            "mutation Tasks { touch }",
            "Tasks",
            json!({ "initial": {} }),
        ),
        ("{ user { id } }", "Tasks", json!({ "initial": {} })),
        (QUERY, "Tasks", json!({ "first": {} })),
        (QUERY, "Tasks", json!("initial")),
    ] {
        assert!(
            LanePlan::new(draft(query, operation, input)).is_err(),
            "{query} {operation}"
        );
    }
}

#[test]
fn kinds_serialize_as_the_cache_reads_them() {
    let scopes = vec![LaneId::try_from("tasks".to_owned()).unwrap()];
    assert_eq!(
        serde_json::to_value(LaneKind::Hydrate).unwrap(),
        json!({ "kind": "hydrate" })
    );
    assert_eq!(
        serde_json::to_value(LaneKind::Membership { scopes }).unwrap(),
        json!({ "kind": "membership", "scopes": ["tasks"] })
    );
    assert_eq!(
        serde_json::to_value(LaneKind::Calendar {
            coverage: vec![CalendarSpan {
                kind: crate::calendar::SpanKind::AllDay,
                start: 1,
                end: 2,
            }]
        })
        .unwrap(),
        json!({ "kind": "calendar", "coverage": [{ "kind": "allDay", "start": 1, "end": 2 }] })
    );
}
