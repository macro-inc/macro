use chrono::TimeZone;
use serde_json::json;

use super::*;
use crate::ids::PropertyId;
use crate::views::LaneKey;
use uuid::Uuid;

const TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7ab1));
const NAME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc01a));
const STATUS: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc01b));
const SAM: RowId = RowId::from_uuid(Uuid::from_u128(0x5a11));
const ALEX: RowId = RowId::from_uuid(Uuid::from_u128(0xa1e8));
const GOING: OptionId = OptionId::from_uuid(Uuid::from_u128(0xc01b));
const PEOPLE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xa1e8));

#[test]
fn a_column_rename_reads_its_change_from_json() {
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "column",
        "table": TABLE,
        "column": STATUS,
        "change": {"kind": "rename", "name": "Due"},
    }))
    .unwrap();

    assert_eq!(
        op,
        DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::Rename {
                name: "Due".into(),
                previous_name: None,
            },
        }
    );
}

#[test]
fn a_rename_names_the_name_it_saw_in_camel_case() {
    assert_eq!(
        serde_json::to_value(DatabaseOp::Table {
            table: TABLE,
            change: TableChange::Rename {
                name: "People".into(),
                previous_name: Some("Guests".into()),
            },
        })
        .unwrap(),
        json!({
            "kind": "table",
            "table": TABLE,
            "change": {"kind": "rename", "name": "People", "previousName": "Guests"},
        })
    );
}

#[test]
fn a_unit_change_is_its_kind_alone() {
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "table",
        "table": TABLE,
        "change": {"kind": "delete"},
    }))
    .unwrap();
    assert_eq!(
        op,
        DatabaseOp::Table {
            table: TABLE,
            change: TableChange::Delete,
        }
    );

    assert_eq!(
        serde_json::to_value(DatabaseOp::Column {
            table: TABLE,
            column: NAME,
            change: ColumnChange::Delete,
        })
        .unwrap(),
        json!({
            "kind": "column",
            "table": TABLE,
            "column": NAME,
            "change": {"kind": "delete"},
        })
    );
}

#[test]
fn an_insert_reads_its_rows_cells_and_values_from_json() {
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "rows",
        "table": TABLE,
        "change": {
            "kind": "insert",
            "rows": [
                [
                    {"column": NAME, "value": {"type": "text", "value": "Sam"}},
                    {"column": STATUS, "value": {"type": "options", "value": [{"label": "Going"}]}},
                ],
                [
                    {"column": NAME, "value": {"type": "clear"}},
                ],
            ],
        },
    }))
    .unwrap();

    assert_eq!(
        op,
        DatabaseOp::Rows {
            table: TABLE,
            change: RowsChange::Insert {
                rows: vec![
                    vec![
                        CellWrite {
                            column: NAME,
                            value: CellValue::Text("Sam".into()),
                        },
                        CellWrite {
                            column: STATUS,
                            value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                        },
                    ],
                    vec![CellWrite {
                        column: NAME,
                        value: CellValue::Clear,
                    }],
                ],
            },
        }
    );
}

#[test]
fn every_value_kind_round_trips_through_json() {
    let values = vec![
        CellValue::Text("Sam".into()),
        CellValue::Number(2.5),
        CellValue::Boolean(true),
        CellValue::Date(Utc.with_ymd_and_hms(2026, 9, 30, 0, 0, 0).unwrap()),
        CellValue::Link(vec!["https://macro.com".into()]),
        CellValue::Options(vec![OptionRef::Id(GOING), OptionRef::Label("Going".into())]),
        CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::User,
            entity_id: "macro|sam@macro.com".into(),
        }]),
        CellValue::Rows(vec![SAM]),
        CellValue::Clear,
    ];

    let encoded = serde_json::to_value(&values).unwrap();

    assert_eq!(
        encoded,
        json!([
            {"type": "text", "value": "Sam"},
            {"type": "number", "value": 2.5},
            {"type": "boolean", "value": true},
            {"type": "date", "value": "2026-09-30T00:00:00Z"},
            {"type": "link", "value": ["https://macro.com"]},
            {"type": "options", "value": [{"id": GOING}, {"label": "Going"}]},
            {"type": "entities", "value": [{"entityType": "USER", "entityId": "macro|sam@macro.com"}]},
            {"type": "rows", "value": [SAM]},
            {"type": "clear"},
        ])
    );
    let decoded: Vec<CellValue> = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded, values);
}

#[test]
fn updates_name_their_rows_uniformly_or_one_by_one() {
    let uniform: DatabaseOp = serde_json::from_value(json!({
        "kind": "rows",
        "table": TABLE,
        "change": {
            "kind": "update",
            "changes": {
                "kind": "uniform",
                "rows": [SAM, ALEX],
                "cells": [{"column": NAME, "value": {"type": "text", "value": "Guest"}}],
            },
        },
    }))
    .unwrap();
    assert_eq!(
        uniform,
        DatabaseOp::Rows {
            table: TABLE,
            change: RowsChange::Update {
                changes: RowChanges::Uniform {
                    rows: vec![SAM, ALEX],
                    cells: vec![CellWrite {
                        column: NAME,
                        value: CellValue::Text("Guest".into()),
                    }],
                },
            },
        }
    );

    let per_row: DatabaseOp = serde_json::from_value(json!({
        "kind": "rows",
        "table": TABLE,
        "change": {
            "kind": "update",
            "changes": {
                "kind": "per_row",
                "rows": [{"row": SAM, "cells": [{"column": NAME, "value": {"type": "text", "value": "Sam"}}]}],
            },
        },
    }))
    .unwrap();
    assert_eq!(
        per_row,
        DatabaseOp::Rows {
            table: TABLE,
            change: RowsChange::Update {
                changes: RowChanges::PerRow {
                    rows: vec![RowChange {
                        row: SAM,
                        cells: vec![CellWrite {
                            column: NAME,
                            value: CellValue::Text("Sam".into()),
                        }],
                    }],
                },
            },
        }
    );
}

#[test]
fn deletes_and_type_changes_read_from_json() {
    let ops: Vec<DatabaseOp> = serde_json::from_value(json!([
        {"kind": "rows", "table": TABLE, "change": {"kind": "delete", "rows": [SAM]}},
        {
            "kind": "column",
            "table": TABLE,
            "column": STATUS,
            "change": {"kind": "change_type", "to": {"type": "select", "multi": true}},
        },
        {
            "kind": "column",
            "table": TABLE,
            "column": NAME,
            "change": {"kind": "change_type", "to": {"type": "entity", "target": "USER", "multi": false}},
        },
        {
            "kind": "column",
            "table": TABLE,
            "column": NAME,
            "change": {"kind": "change_type", "to": {"type": "relation", "database": PEOPLE, "table": TABLE}},
        },
    ]))
    .unwrap();

    assert_eq!(
        ops,
        vec![
            DatabaseOp::Rows {
                table: TABLE,
                change: RowsChange::Delete { rows: vec![SAM] },
            },
            DatabaseOp::Column {
                table: TABLE,
                column: STATUS,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Select { multi: true },
                },
            },
            DatabaseOp::Column {
                table: TABLE,
                column: NAME,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Entity {
                        target: EntityKind::User,
                        multi: false,
                    },
                },
            },
            DatabaseOp::Column {
                table: TABLE,
                column: NAME,
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Relation {
                        database: PEOPLE,
                        table: TABLE,
                    },
                },
            },
        ]
    );
}

#[test]
fn results_say_what_each_op_did_in_camel_case() {
    let results = vec![
        OpResult::Rows {
            table: TABLE,
            table_version: TableVersion(4),
            change: RowsResult::Inserted { rows: vec![SAM] },
        },
        OpResult::Column {
            table: TABLE,
            column: NAME,
            table_version: TableVersion(5),
            change: ColumnResult::TypeChanged,
        },
        OpResult::Table {
            table: TABLE,
            table_version: None,
            change: TableResult::Deleted,
        },
    ];

    assert_eq!(
        serde_json::to_value(&results).unwrap(),
        json!([
            {
                "kind": "rows",
                "table": TABLE,
                "tableVersion": 4,
                "change": {"kind": "inserted", "rows": [SAM]},
            },
            {
                "kind": "column",
                "table": TABLE,
                "column": NAME,
                "tableVersion": 5,
                "change": {"kind": "type_changed"},
            },
            {"kind": "table", "table": TABLE, "change": {"kind": "deleted"}},
        ])
    );
    assert_eq!(results[0].table_version(), Some(TableVersion(4)));
    assert_eq!(results[2].table_version(), None);
}

#[test]
fn an_option_update_tells_a_missing_colour_from_a_cleared_one() {
    let option = OptionId::from_uuid(Uuid::from_u128(0x0b7));
    let read = |change| {
        serde_json::from_value::<DatabaseOp>(json!({
            "kind": "column",
            "table": TABLE,
            "column": STATUS,
            "change": change,
        }))
        .unwrap()
    };

    assert_eq!(
        read(json!({"kind": "update_option", "option": option, "label": "Maybe"})),
        DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::UpdateOption {
                option,
                label: Some("Maybe".into()),
                color: None,
            },
        }
    );
    assert_eq!(
        read(json!({"kind": "update_option", "option": option, "color": null})),
        DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::UpdateOption {
                option,
                label: None,
                color: Some(None),
            },
        }
    );
    assert_eq!(
        read(json!({"kind": "update_option", "option": option, "color": "#12A594"})),
        DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::UpdateOption {
                option,
                label: None,
                color: Some(Some("#12A594".into())),
            },
        }
    );
    assert_eq!(
        serde_json::to_value(DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::UpdateOption {
                option,
                label: None,
                color: Some(None),
            },
        })
        .unwrap(),
        json!({
            "kind": "column",
            "table": TABLE,
            "column": STATUS,
            "change": {"kind": "update_option", "option": option, "color": null},
        })
    );
}

#[test]
fn an_option_removal_names_its_table_column_and_option() {
    let option = OptionId::from_uuid(Uuid::from_u128(0x0b7));
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "column",
        "table": TABLE,
        "column": STATUS,
        "change": {"kind": "delete_option", "option": option},
    }))
    .unwrap();
    assert_eq!(
        op,
        DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::DeleteOption { option },
        }
    );
    assert_eq!(op.table(), Some(TABLE));
}

#[test]
fn view_ops_read_their_table_view_and_card_from_json() {
    let view = ViewId::from_uuid(Uuid::from_u128(0x71e));
    let lane = OptionId::from_uuid(Uuid::from_u128(0x0b7));
    let read = |body| serde_json::from_value::<DatabaseOp>(body).unwrap();

    assert_eq!(
        read(json!({
            "kind": "view",
            "table": TABLE,
            "view": view,
            "change": {"kind": "update", "name": "By stage"},
        })),
        DatabaseOp::View {
            table: TABLE,
            view,
            change: ViewChange::Update {
                name: Some("By stage".into()),
                query: None,
                layout: None,
            },
        }
    );
    assert_eq!(
        read(json!({
            "kind": "table",
            "table": TABLE,
            "change": {"kind": "reorder_views", "order": [view]},
        })),
        DatabaseOp::Table {
            table: TABLE,
            change: TableChange::ReorderViews { order: vec![view] },
        }
    );
    assert_eq!(
        read(json!({
            "kind": "view",
            "table": TABLE,
            "view": view,
            "change": {
                "kind": "move_card",
                "row": SAM,
                "lane": {"kind": "option", "id": lane},
                "before": ALEX,
            },
        })),
        DatabaseOp::View {
            table: TABLE,
            view,
            change: ViewChange::MoveCard {
                row: SAM,
                lane: LaneKey::Option(lane),
                before: Some(ALEX),
                after: None,
            },
        }
    );
    assert_eq!(
        read(json!({
            "kind": "view",
            "table": TABLE,
            "view": view,
            "change": {"kind": "delete"},
        }))
        .table(),
        Some(TABLE)
    );
}

#[test]
fn a_table_creation_carries_the_id_its_client_minted() {
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "table",
        "table": TABLE,
        "change": {"kind": "create", "name": "Guests"},
    }))
    .unwrap();
    assert_eq!(
        op,
        DatabaseOp::Table {
            table: TABLE,
            change: TableChange::Create {
                name: "Guests".into(),
            },
        }
    );
    assert_eq!(op.table(), Some(TABLE));
}

#[test]
fn a_table_reorder_names_no_one_table() {
    let other = TableId::from_uuid(Uuid::from_u128(0x7ab2));
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "reorder_tables",
        "order": [other, TABLE],
    }))
    .unwrap();
    assert_eq!(
        op,
        DatabaseOp::ReorderTables {
            order: vec![other, TABLE],
        }
    );
    assert_eq!(op.table(), None);
}

#[test]
fn a_new_select_column_reads_its_type_and_minted_options_from_json() {
    let op: DatabaseOp = serde_json::from_value(json!({
        "kind": "column",
        "table": TABLE,
        "column": STATUS,
        "change": {
            "kind": "create",
            "definition": {
                "source": "new",
                "name": "Status",
                "type": {"type": "select", "multi": false},
                "options": [{"id": GOING, "label": "Going"}],
            },
            "after": NAME,
        },
    }))
    .unwrap();
    assert_eq!(
        op,
        DatabaseOp::Column {
            table: TABLE,
            column: STATUS,
            change: ColumnChange::Create {
                definition: NewColumn::New {
                    name: "Status".into(),
                    kind: ColumnKind::Select { multi: false },
                    options: vec![NewOption {
                        id: GOING,
                        label: "Going".into(),
                    }],
                    infer_type: false,
                },
                after: Some(NAME),
            },
        }
    );
}

#[test]
fn a_column_binding_an_existing_property_names_only_the_property() {
    let property = PropertyId::from_uuid(Uuid::from_u128(0x9e0));
    let op = DatabaseOp::Column {
        table: TABLE,
        column: STATUS,
        change: ColumnChange::Create {
            definition: NewColumn::Existing { property },
            after: None,
        },
    };
    assert_eq!(
        serde_json::to_value(&op).unwrap(),
        json!({
            "kind": "column",
            "table": TABLE,
            "column": STATUS,
            "change": {
                "kind": "create",
                "definition": {"source": "existing", "property": property},
            },
        })
    );
}

#[test]
fn a_taken_id_names_what_it_names() {
    let view = ViewId::from_uuid(Uuid::from_u128(0x71e));
    assert_eq!(
        serde_json::to_value([TakenId::Column(STATUS), TakenId::View(view)]).unwrap(),
        json!([{"kind": "column", "id": STATUS}, {"kind": "view", "id": view}])
    );
}
