use chrono::{TimeZone, Utc};
use models_databases::{CellValue, EntityKind, EntityRef, OptionRef, RowId};
use serde_json::json;
use uuid::Uuid;

use super::*;

const TITLE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(1));
const DATE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(2));
const ATTENDEES: ColumnId = ColumnId::from_uuid(Uuid::from_u128(3));
const DURATION: ColumnId = ColumnId::from_uuid(Uuid::from_u128(4));
const RECORDING: ColumnId = ColumnId::from_uuid(Uuid::from_u128(5));
const FOLLOW_UP: ColumnId = ColumnId::from_uuid(Uuid::from_u128(6));
const OWNER: ColumnId = ColumnId::from_uuid(Uuid::from_u128(7));
const ACCOUNT: ColumnId = ColumnId::from_uuid(Uuid::from_u128(8));
const STATUS: ColumnId = ColumnId::from_uuid(Uuid::from_u128(9));

/// The meetings table a note-taker posts to: one column of each kind a
/// payload commonly fills.
fn meetings() -> Vec<WebhookColumn> {
    vec![
        WebhookColumn {
            id: TITLE,
            name: "Title".to_string(),
            kind: Some(ColumnKind::Text),
        },
        WebhookColumn {
            id: DATE,
            name: "Date".to_string(),
            kind: Some(ColumnKind::Date),
        },
        WebhookColumn {
            id: ATTENDEES,
            name: "Attendees".to_string(),
            kind: Some(ColumnKind::Select { multi: true }),
        },
        WebhookColumn {
            id: DURATION,
            name: "Duration (min)".to_string(),
            kind: Some(ColumnKind::Number),
        },
        WebhookColumn {
            id: RECORDING,
            name: "Recording".to_string(),
            kind: Some(ColumnKind::Link),
        },
        WebhookColumn {
            id: FOLLOW_UP,
            name: "Needs follow-up".to_string(),
            kind: Some(ColumnKind::Boolean),
        },
        WebhookColumn {
            id: OWNER,
            name: "Owner".to_string(),
            kind: Some(ColumnKind::Entity {
                target: EntityKind::User,
                multi: false,
            }),
        },
        WebhookColumn {
            id: ACCOUNT,
            name: "Account".to_string(),
            kind: Some(ColumnKind::Relation {
                database: models_databases::DatabaseId::from_uuid(Uuid::from_u128(100)),
                table: models_databases::TableId::from_uuid(Uuid::from_u128(101)),
            }),
        },
        WebhookColumn {
            id: STATUS,
            name: "Status".to_string(),
            kind: Some(ColumnKind::Select { multi: false }),
        },
    ]
}

#[test]
fn an_object_is_one_row_of_cells_by_column_name() {
    let payload = json!({
        "Title": "Acme kickoff",
        "Date": "2026-10-09T15:00:00Z",
        "Attendees": ["Alice", "Bob"],
        "Duration (min)": 45,
        "Recording": null,
        "Needs follow-up": true,
        "Owner": "macro|alice@acme.com",
        "Account": "00000000-0000-0000-0000-0000000000c8",
        "Status": "Scheduled"
    });

    let rows = rows_from_payload(&meetings(), &payload).unwrap();

    assert_eq!(
        rows,
        vec![vec![
            CellWrite {
                column: TITLE,
                value: CellValue::Text("Acme kickoff".to_string()),
            },
            CellWrite {
                column: DATE,
                value: CellValue::Date(Utc.with_ymd_and_hms(2026, 10, 9, 15, 0, 0).unwrap()),
            },
            CellWrite {
                column: ATTENDEES,
                value: CellValue::Options(vec![
                    OptionRef::Label("Alice".to_string()),
                    OptionRef::Label("Bob".to_string()),
                ]),
            },
            CellWrite {
                column: DURATION,
                value: CellValue::Number(45.0),
            },
            CellWrite {
                column: FOLLOW_UP,
                value: CellValue::Boolean(true),
            },
            CellWrite {
                column: OWNER,
                value: CellValue::Entities(vec![EntityRef {
                    entity_type: EntityKind::User,
                    entity_id: "macro|alice@acme.com".to_string(),
                }]),
            },
            CellWrite {
                column: ACCOUNT,
                value: CellValue::Rows(vec![RowId::from_uuid(Uuid::from_u128(200))]),
            },
            CellWrite {
                column: STATUS,
                value: CellValue::Options(vec![OptionRef::Label("Scheduled".to_string())]),
            },
        ]]
    );
}

#[test]
fn an_array_is_a_row_per_object_in_order() {
    let payload = json!([
        { "Title": "First" },
        { "Title": "Second", "Duration (min)": 30 }
    ]);

    let rows = rows_from_payload(&meetings(), &payload).unwrap();

    assert_eq!(
        rows,
        vec![
            vec![CellWrite {
                column: TITLE,
                value: CellValue::Text("First".to_string()),
            }],
            vec![
                CellWrite {
                    column: TITLE,
                    value: CellValue::Text("Second".to_string()),
                },
                CellWrite {
                    column: DURATION,
                    value: CellValue::Number(30.0),
                },
            ],
        ]
    );
}

#[test]
fn an_empty_object_is_an_empty_row() {
    assert_eq!(
        rows_from_payload(&meetings(), &json!({})).unwrap(),
        vec![Vec::<CellWrite>::new()]
    );
}

/// Keys find their column however a sender spells the name, or by id.
#[test]
fn keys_name_columns_loosely_or_by_id() {
    let cases = [
        json!({ "title": "x" }),
        json!({ "TITLE": "x" }),
        json!({ "  Title ": "x" }),
        json!({ "00000000-0000-0000-0000-000000000001": "x" }),
    ];
    for payload in cases {
        assert_eq!(
            rows_from_payload(&meetings(), &payload).unwrap(),
            vec![vec![CellWrite {
                column: TITLE,
                value: CellValue::Text("x".to_string()),
            }]],
            "{payload}"
        );
    }
}

/// What senders send that is not quite the column's type, and the cell it
/// becomes.
#[test]
fn values_are_shaped_to_their_column() {
    let cases = [
        (
            json!({ "Title": 42 }),
            TITLE,
            CellValue::Text("42".to_string()),
        ),
        (
            json!({ "Title": false }),
            TITLE,
            CellValue::Text("false".to_string()),
        ),
        (
            json!({ "Duration (min)": "12.5" }),
            DURATION,
            CellValue::Number(12.5),
        ),
        (
            json!({ "Duration (min)": " 7 " }),
            DURATION,
            CellValue::Number(7.0),
        ),
        (
            json!({ "Needs follow-up": "TRUE" }),
            FOLLOW_UP,
            CellValue::Boolean(true),
        ),
        (
            json!({ "Needs follow-up": "false" }),
            FOLLOW_UP,
            CellValue::Boolean(false),
        ),
        (
            json!({ "Date": "2026-10-09" }),
            DATE,
            CellValue::Date(Utc.with_ymd_and_hms(2026, 10, 9, 0, 0, 0).unwrap()),
        ),
        (
            json!({ "Date": "2026-10-09T10:00:00-05:00" }),
            DATE,
            CellValue::Date(Utc.with_ymd_and_hms(2026, 10, 9, 15, 0, 0).unwrap()),
        ),
        (
            json!({ "Recording": "https://example.com/r/1" }),
            RECORDING,
            CellValue::Link(vec!["https://example.com/r/1".to_string()]),
        ),
        (
            json!({ "Recording": ["https://a.example", "https://b.example"] }),
            RECORDING,
            CellValue::Link(vec![
                "https://a.example".to_string(),
                "https://b.example".to_string(),
            ]),
        ),
        (
            json!({ "Attendees": "Alice" }),
            ATTENDEES,
            CellValue::Options(vec![OptionRef::Label("Alice".to_string())]),
        ),
        (
            json!({ "Status": 3 }),
            STATUS,
            CellValue::Options(vec![OptionRef::Label("3".to_string())]),
        ),
        (
            json!({ "Account": ["00000000-0000-0000-0000-0000000000c8"] }),
            ACCOUNT,
            CellValue::Rows(vec![RowId::from_uuid(Uuid::from_u128(200))]),
        ),
    ];
    for (payload, column, value) in cases {
        assert_eq!(
            rows_from_payload(&meetings(), &payload).unwrap(),
            vec![vec![CellWrite { column, value }]],
            "{payload}"
        );
    }
}

/// An empty value is no cell, as `null` is: the row starts with it empty.
#[test]
fn empty_values_leave_the_cell_empty() {
    let payload = json!({
        "Title": null,
        "Attendees": [],
        "Recording": []
    });
    assert_eq!(
        rows_from_payload(&meetings(), &payload).unwrap(),
        vec![Vec::<CellWrite>::new()]
    );
}

/// Every payload the mapping refuses, and each problem it reports.
#[test]
fn payloads_that_do_not_fit_are_refused_with_every_problem() {
    let cases = [
        (
            json!("Acme kickoff"),
            vec![PayloadProblem {
                row: None,
                field: None,
                message: "expected a JSON object, or an array of objects, one per row".to_string(),
            }],
        ),
        (
            json!([]),
            vec![PayloadProblem {
                row: None,
                field: None,
                message: "expected at least one row".to_string(),
            }],
        ),
        (
            json!([{ "Title": "ok" }, 7]),
            vec![PayloadProblem {
                row: Some(1),
                field: None,
                message: "expected a JSON object".to_string(),
            }],
        ),
        (
            json!({ "Titel": "x", "Duration (min)": "soon" }),
            vec![
                PayloadProblem {
                    row: None,
                    field: Some("Titel".to_string()),
                    message: "no column is named \"Titel\"".to_string(),
                },
                PayloadProblem {
                    row: None,
                    field: Some("Duration (min)".to_string()),
                    message: "expected a number".to_string(),
                },
            ],
        ),
        (
            json!({ "Title": "a", "title": "b" }),
            vec![PayloadProblem {
                row: None,
                field: Some("title".to_string()),
                message: "\"Title\" is named twice".to_string(),
            }],
        ),
        (
            json!({ "Title": { "text": "x" } }),
            vec![PayloadProblem {
                row: None,
                field: Some("Title".to_string()),
                message: "expected text".to_string(),
            }],
        ),
        (
            json!({ "Needs follow-up": "maybe" }),
            vec![PayloadProblem {
                row: None,
                field: Some("Needs follow-up".to_string()),
                message: "expected true or false".to_string(),
            }],
        ),
        (
            json!({ "Date": "next tuesday" }),
            vec![PayloadProblem {
                row: None,
                field: Some("Date".to_string()),
                message: "expected an ISO 8601 date, like 2026-10-09 or 2026-10-09T15:00:00Z"
                    .to_string(),
            }],
        ),
        (
            json!({ "Attendees": [{ "name": "Alice" }] }),
            vec![PayloadProblem {
                row: None,
                field: Some("Attendees".to_string()),
                message: "expected option labels".to_string(),
            }],
        ),
        (
            json!({ "Account": "acme" }),
            vec![PayloadProblem {
                row: None,
                field: Some("Account".to_string()),
                message: "expected row ids".to_string(),
            }],
        ),
    ];
    for (payload, problems) in cases {
        assert_eq!(
            rows_from_payload(&meetings(), &payload),
            Err(problems),
            "{payload}"
        );
    }
}

#[test]
fn two_columns_with_one_name_must_be_named_by_id() {
    let mut columns = meetings();
    columns.push(WebhookColumn {
        id: ColumnId::from_uuid(Uuid::from_u128(11)),
        name: "title".to_string(),
        kind: Some(ColumnKind::Text),
    });

    assert_eq!(
        rows_from_payload(&columns, &json!({ "Title": "x" })),
        Err(vec![PayloadProblem {
            row: None,
            field: Some("Title".to_string()),
            message: "several columns are named \"Title\"; name it by its column id".to_string(),
        }])
    );
    assert_eq!(
        rows_from_payload(
            &columns,
            &json!({ "00000000-0000-0000-0000-00000000000b": "x" })
        ),
        Ok(vec![vec![CellWrite {
            column: ColumnId::from_uuid(Uuid::from_u128(11)),
            value: CellValue::Text("x".to_string()),
        }]])
    );
}

#[test]
fn a_problem_in_an_array_names_its_row() {
    let payload = json!([{ "Title": "ok" }, { "Nope": 1 }]);
    assert_eq!(
        rows_from_payload(&meetings(), &payload),
        Err(vec![PayloadProblem {
            row: Some(1),
            field: Some("Nope".to_string()),
            message: "no column is named \"Nope\"".to_string(),
        }])
    );
}

#[test]
fn at_most_a_hundred_rows_per_call() {
    let payload = Value::Array(vec![json!({}); MAX_ROWS + 1]);
    assert_eq!(
        rows_from_payload(&meetings(), &payload),
        Err(vec![PayloadProblem {
            row: None,
            field: None,
            message: "at most 100 rows per call".to_string(),
        }])
    );
}
