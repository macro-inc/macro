// Synthetic fixtures follow Notion-Version 2026-03-11:
// https://developers.notion.com/reference/view
// https://developers.notion.com/guides/data-apis/working-with-views
// https://developers.notion.com/reference/filter-data-source-entries
// https://developers.notion.com/reference/sort-data-source-entries
use super::*;
use models_databases::{ColumnId, ColumnKind, views::*};
use serde_json::json;
use std::collections::BTreeMap;
use uuid::Uuid;

#[test]
fn table_view_preserves_nested_filters_sort_priority_and_widths() {
    let view: NotionView = serde_json::from_value(json!({
        "object": "view", "id": "00000000-0000-4000-8000-000000000001",
        "parent": {"type": "database_id", "database_id": "00000000-0000-4000-8000-000000000002"},
        "data_source_id": "00000000-0000-4000-8000-000000000003",
        "name": "Open work", "type": "table",
        "filter": {"and": [
            {"property": "done", "checkbox": {"equals": false}},
            {"or": [
                {"property": "Name", "title": {"contains": "release"}},
                {"property": "Name", "title": {"starts_with": "fix"}}
            ]}
        ]},
        "sorts": [{"property": "Name", "direction": "ascending"}, {"property": "done", "direction": "descending"}],
        "configuration": {"type": "table", "properties": [{"property_id": "title", "visible": true, "width": 240}]}
    })).unwrap();
    let title = ColumnId::from_uuid(Uuid::from_u128(10));
    let done = ColumnId::from_uuid(Uuid::from_u128(11));
    let columns = vec![
        ViewColumnBinding {
            property_id: "title".into(),
            property_name: "Name".into(),
            column: title,
            kind: ColumnKind::Text,
            options: BTreeMap::new(),
            snapshot: false,
        },
        ViewColumnBinding {
            property_id: "done".into(),
            property_name: "Done".into(),
            column: done,
            kind: ColumnKind::Boolean,
            options: BTreeMap::new(),
            snapshot: false,
        },
    ];
    let translated = translate(&view, &columns);
    assert!(translated.losses.is_empty(), "{:?}", translated.losses);
    let filter = translated.view.query.filter.unwrap();
    assert_eq!(filter.conjunction, Conjunction::And);
    assert_eq!(filter.conditions.len(), 2);
    assert!(
        matches!(&filter.conditions[1], FilterNode::Group(group) if group.conjunction == Conjunction::Or && group.conditions.len() == 2)
    );
    assert_eq!(
        translated.view.query.sort,
        vec![
            SortKey {
                column: title,
                direction: SortDirection::Ascending
            },
            SortKey {
                column: done,
                direction: SortDirection::Descending
            }
        ]
    );
    assert_eq!(
        translated.view.layout,
        RequestedLayout::Table {
            columns: vec![ViewColumn {
                column: title,
                width: Some(240)
            }]
        }
    );
}

#[test]
fn unsupported_nested_filter_is_atomic_and_reports_each_failed_branch() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Filtered", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"or":[{"property":"Name", "title":{"contains":"release"}}, {"property":"missing", "date":{"this_week":{}}}, {"property":"formula", "formula":{"number":{"equals":3}}}]}
    })).unwrap();
    let columns = vec![ViewColumnBinding {
        property_id: "title".into(),
        property_name: "Name".into(),
        column: ColumnId::from_uuid(Uuid::from_u128(1)),
        kind: ColumnKind::Text,
        options: BTreeMap::new(),
        snapshot: false,
    }];
    let translated = translate(&view, &columns);
    assert!(translated.view.query.filter.is_none());
    assert_eq!(
        translated
            .losses
            .iter()
            .filter(|loss| loss.kind == ViewLossKind::Filter)
            .map(|loss| loss.path.as_str())
            .collect::<Vec<_>>(),
        vec!["filter.or[1]", "filter.or[2]"]
    );
}

#[test]
fn select_option_ids_survive_renames_and_board_lanes_follow_sorted_labels() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"By status", "type":"board",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"property":"stat", "status":{"equals":"Open"}},
        "sorts":[{"property":"Renamed status", "direction":"descending"}],
        "configuration":{"type":"board", "properties":[{"property_id":"stat", "visible":true}],
            "group_by":{"type":"status", "property_id":"stat", "group_by":"option", "sort":{"type":"ascending"}, "hide_empty_groups":true},
            "sub_group_by":{"type":"checkbox", "property_id":"done"}, "cover":{"type":"page_cover"}}
    })).unwrap();
    let id = ColumnId::from_uuid(Uuid::from_u128(1));
    let open = models_databases::OptionId::from_uuid(Uuid::from_u128(2));
    let closed = models_databases::OptionId::from_uuid(Uuid::from_u128(3));
    let columns = vec![ViewColumnBinding {
        property_id: "stat".into(),
        property_name: "Renamed status".into(),
        column: id,
        kind: ColumnKind::Select { multi: false },
        options: BTreeMap::from([("Open".into(), open), ("Closed".into(), closed)]),
        snapshot: false,
    }];
    let translated = translate(&view, &columns);
    assert_eq!(
        translated.view.query.filter.unwrap().conditions,
        vec![FilterNode::Condition(FilterCondition {
            column: id,
            test: FilterTest::Options {
                operator: SetOperator::IsAnyOf,
                options: vec![open]
            }
        })]
    );
    assert_eq!(
        translated.view.layout,
        RequestedLayout::Board {
            group_by: id,
            title: None,
            lanes: vec![
                Lane {
                    key: LaneKey::Option(closed),
                    hidden: false
                },
                Lane {
                    key: LaneKey::Option(open),
                    hidden: false
                }
            ],
            card_fields: vec![id],
            hide_empty_lanes: true
        }
    );
    assert_eq!(
        translated
            .losses
            .iter()
            .map(|loss| loss.path.as_str())
            .collect::<std::collections::BTreeSet<_>>(),
        std::collections::BTreeSet::from(["configuration.cover", "configuration.sub_group_by"])
    );
}

#[test]
fn unsupported_layout_settings_and_timestamp_sorts_are_reported() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Calendar", "type":"calendar",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "sorts":[{"timestamp":"created_time", "direction":"ascending"}],
        "configuration":{"type":"calendar", "date_property_id":"date", "show_weekends":false, "future_setting":true},
        "quick_filters":{"Name":{"title":{"contains":"x"}}}
    })).unwrap();
    let translated = translate(&view, &[]);
    assert!(matches!(
        translated.view.layout,
        RequestedLayout::Table { .. }
    ));
    assert!(translated.view.query.sort.is_empty());
    for path in [
        "type",
        "sorts[0]",
        "configuration.date_property_id",
        "configuration.show_weekends",
        "configuration.future_setting",
        "quick_filters",
    ] {
        assert!(
            translated.losses.iter().any(|loss| loss.path == path),
            "missing {path}"
        );
    }
}

#[test]
fn timeline_uses_an_actual_date_range_binding_and_reports_separate_end_columns() {
    let mut view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Schedule", "type":"timeline",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "configuration":{"type":"timeline", "date_property_id":"date", "properties":[]}
    }))
    .unwrap();
    let id = ColumnId::from_uuid(Uuid::from_u128(1));
    let columns = vec![ViewColumnBinding {
        property_id: "date".into(),
        property_name: "When".into(),
        column: id,
        kind: ColumnKind::DateRange,
        options: BTreeMap::new(),
        snapshot: false,
    }];
    let translated = translate(&view, &columns);
    assert!(translated.losses.is_empty());
    assert_eq!(
        translated.view.layout,
        RequestedLayout::Timeline {
            range: id,
            title: None,
            group_by: None,
            bar_fields: vec![],
            color_by: None
        }
    );
    view.configuration.as_mut().unwrap()["end_date_property_id"] = json!("end");
    let separate = translate(&view, &columns);
    assert!(matches!(
        separate.view.layout,
        RequestedLayout::Table { .. }
    ));
    assert!(
        separate
            .losses
            .iter()
            .any(|loss| loss.kind == ViewLossKind::Layout)
    );
}

#[test]
fn a_property_id_takes_priority_over_another_propertys_matching_name() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Priority", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"property":"id", "checkbox":{"equals":true}}
    }))
    .unwrap();
    let wrong = ColumnId::from_uuid(Uuid::from_u128(1));
    let right = ColumnId::from_uuid(Uuid::from_u128(2));
    let columns = vec![
        ViewColumnBinding {
            property_id: "other".into(),
            property_name: "id".into(),
            column: wrong,
            kind: ColumnKind::Boolean,
            options: BTreeMap::new(),
            snapshot: false,
        },
        ViewColumnBinding {
            property_id: "id".into(),
            property_name: "Check".into(),
            column: right,
            kind: ColumnKind::Boolean,
            options: BTreeMap::new(),
            snapshot: false,
        },
    ];
    assert_eq!(
        translate(&view, &columns)
            .view
            .query
            .filter
            .unwrap()
            .conditions[0],
        FilterNode::Condition(FilterCondition {
            column: right,
            test: FilterTest::Checkbox { checked: true }
        })
    );
}

#[test]
fn computed_snapshots_never_inherit_numeric_sorts_or_filters() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Computed", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"property":"calc", "formula":{"number":{"greater_than":10}}},
        "sorts":[{"property":"calc", "direction":"ascending"}]
    }))
    .unwrap();
    let columns = vec![ViewColumnBinding {
        property_id: "calc".into(),
        property_name: "Total".into(),
        column: ColumnId::from_uuid(Uuid::from_u128(1)),
        kind: ColumnKind::Text,
        options: BTreeMap::new(),
        snapshot: true,
    }];
    let translated = translate(&view, &columns);
    assert!(translated.view.query.filter.is_none());
    assert!(translated.view.query.sort.is_empty());
    assert_eq!(
        translated
            .losses
            .iter()
            .map(|loss| loss.kind)
            .collect::<Vec<_>>(),
        vec![ViewLossKind::Filter, ViewLossKind::Sort]
    );
}

#[test]
fn date_and_number_filters_select_rows_in_the_translated_query() {
    use chrono::TimeZone;
    use models_databases::CellValue;
    use std::collections::HashMap;
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Due", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"and":[{"property":"date", "date":{"equals":"2026-01-02"}}, {"property":"score", "number":{"greater_than_or_equal_to":10}}]}
    })).unwrap();
    let date = ColumnId::from_uuid(Uuid::from_u128(1));
    let score = ColumnId::from_uuid(Uuid::from_u128(2));
    let columns = vec![
        ViewColumnBinding {
            property_id: "date".into(),
            property_name: "Date".into(),
            column: date,
            kind: ColumnKind::Date,
            options: BTreeMap::new(),
            snapshot: false,
        },
        ViewColumnBinding {
            property_id: "score".into(),
            property_name: "Score".into(),
            column: score,
            kind: ColumnKind::Number,
            options: BTreeMap::new(),
            snapshot: false,
        },
    ];
    let translated = translate(&view, &columns);
    assert!(translated.losses.is_empty());
    let filter = translated.view.query.filter.unwrap();
    let mut cells = HashMap::from([
        (
            date,
            CellValue::Date(
                chrono::Utc
                    .with_ymd_and_hms(2026, 1, 2, 23, 59, 59)
                    .unwrap(),
            ),
        ),
        (score, CellValue::Number(10.0)),
    ]);
    assert!(eval::matches(&filter, &cells));
    cells.insert(score, CellValue::Number(9.0));
    assert!(!eval::matches(&filter, &cells));
    cells.insert(score, CellValue::Number(10.0));
    cells.insert(
        date,
        CellValue::Date(chrono::Utc.with_ymd_and_hms(2026, 1, 3, 0, 0, 0).unwrap()),
    );
    assert!(!eval::matches(&filter, &cells));
}

#[test]
fn date_range_presence_is_valid_and_instant_predicates_report_a_loss() {
    let mut view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Spans", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"property":"date", "date":{"is_not_empty":true}}
    }))
    .unwrap();
    let id = ColumnId::from_uuid(Uuid::from_u128(1));
    let columns = vec![ViewColumnBinding {
        property_id: "date".into(),
        property_name: "When".into(),
        column: id,
        kind: ColumnKind::DateRange,
        options: BTreeMap::new(),
        snapshot: false,
    }];
    let translated = translate(&view, &columns);
    assert!(translated.losses.is_empty());
    assert_eq!(
        translated.view.query.filter.unwrap().conditions,
        vec![FilterNode::Condition(FilterCondition {
            column: id,
            test: FilterTest::Presence {
                operator: PresenceOperator::IsNotEmpty
            }
        })]
    );
    view.filter = Some(json!({"property":"date", "date":{"equals":"2026-01-02"}}));
    let translated = translate(&view, &columns);
    assert!(translated.view.query.filter.is_none());
    assert!(
        translated
            .losses
            .iter()
            .any(|loss| loss.kind == ViewLossKind::Filter)
    );
}

#[test]
fn people_presence_cannot_assume_every_source_person_was_matched_to_macro() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"type":"database_id", "database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Assigned", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"property":"owner", "people":{"is_not_empty":true}}
    }))
    .unwrap();
    let columns = vec![ViewColumnBinding {
        property_id: "owner".into(),
        property_name: "Owner".into(),
        column: ColumnId::from_uuid(Uuid::from_u128(1)),
        kind: ColumnKind::Entity {
            target: models_databases::EntityKind::User,
            multi: true,
        },
        options: BTreeMap::new(),
        snapshot: false,
    }];
    let translated = translate(&view, &columns);
    assert!(translated.view.query.filter.is_none());
    assert!(
        translated
            .losses
            .iter()
            .any(|loss| loss.kind == ViewLossKind::Filter && loss.path == "filter")
    );
}

#[test]
fn approximating_an_and_keeps_supported_clauses_and_drops_an_incomplete_or() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Filtered", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"and":[
            {"property":"title", "title":{"contains":"release"}},
            {"or":[{"property":"title", "title":{"contains":"fix"}},
                     {"property":"missing", "date":{"this_week":{}}}]},
            {"property":"unknown", "formula":{"number":{"equals":3}}}
        ]}
    }))
    .unwrap();
    let translated = translate(
        &view,
        &[ViewColumnBinding {
            property_id: "title".into(),
            property_name: "Name".into(),
            column: ColumnId::from_uuid(Uuid::from_u128(1)),
            kind: ColumnKind::Text,
            options: BTreeMap::new(),
            snapshot: false,
        }],
    );
    let filter = translated.view.query.filter.unwrap();
    assert_eq!(filter.conjunction, Conjunction::And);
    assert_eq!(filter.conditions.len(), 1);
    assert_eq!(
        translated
            .losses
            .iter()
            .filter(|loss| loss.kind == ViewLossKind::Filter)
            .count(),
        2
    );
}

#[test]
fn negative_filters_on_collapsed_options_are_omitted_to_keep_source_rows() {
    let view: NotionView = serde_json::from_value(json!({
        "parent":{"database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Except open", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003",
        "filter":{"property":"stat", "select":{"does_not_equal":"Open"}}
    }))
    .unwrap();
    let option = models_databases::OptionId::from_uuid(Uuid::from_u128(2));
    let columns = vec![ViewColumnBinding {
        property_id: "stat".into(),
        property_name: "Status".into(),
        column: ColumnId::from_uuid(Uuid::from_u128(1)),
        kind: ColumnKind::Select { multi: false },
        options: BTreeMap::from([("Open".into(), option), ("OPEN".into(), option)]),
        snapshot: false,
    }];
    let translated = translate(&view, &columns);
    assert!(
        translated.view.query.filter.is_none(),
        "the source's OPEN rows must survive a does-not-equal Open filter"
    );
    assert!(
        translated
            .losses
            .iter()
            .any(|loss| loss.kind == ViewLossKind::Filter)
    );
}

mod whitespace;

#[test]
fn typed_view_settings_are_explicit_at_the_translation_boundary() {
    let view:NotionView=serde_json::from_value(json!({"id":"00000000-0000-4000-8000-000000000001","name":"Active tasks","type":"table","parent":{"database_id":"00000000-0000-4000-8000-000000000002"},"configuration":{"properties":[{"property_id":"owner","visible":false}],"future_key":true}})).unwrap();
    let binding = ViewColumnBinding {
        property_id: "owner".into(),
        property_name: "Owner".into(),
        column: ColumnId::from_uuid(Uuid::from_u128(1)),
        kind: ColumnKind::Text,
        options: BTreeMap::new(),
        snapshot: false,
    };
    let losses = translate(&view, &[binding]).losses;
    let visibility = losses
        .iter()
        .find(|loss| loss.path.ends_with(".visible"))
        .unwrap();
    assert_eq!(
        serde_json::to_value(visibility)
            .unwrap()
            .get("setting")
            .and_then(serde_json::Value::as_str),
        Some("column_visibility")
    );
    let other = losses
        .iter()
        .find(|loss| loss.path.ends_with("future_key"))
        .unwrap();
    assert_eq!(
        serde_json::to_value(other)
            .unwrap()
            .get("setting")
            .and_then(serde_json::Value::as_str),
        Some("other")
    );
}
