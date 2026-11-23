use super::*;
use models_databases::{CellValue, OptionId, OptionRef};
use std::collections::HashMap;

#[test]
fn decoded_saved_view_ids_keep_status_board_query_and_lanes() {
    let view: NotionView = serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-000000000001",
        "parent": {"database_id": "00000000-0000-4000-8000-000000000002"},
        "data_source_id": "00000000-0000-4000-8000-000000000003",
        "name": "Board",
        "type": "board",
        "request_id": "transport-metadata",
        "filter": {"property": "a}", "property_name": "Status", "status": {"does_not_equal": "Done"}},
        "sorts": [
            {"property": "b|", "property_name": "Due", "direction": "descending"},
            {"property": "a}", "direction": "ascending"}
        ],
        "configuration": {
            "type": "board",
            "group_by": {"type": "status", "property_id": "a}", "property_name": "Status",
                         "group_by": "option", "sort": {"type":"ascending"}, "hide_empty_groups": false},
            "properties": [{"property_id": "b|", "property_name": "Due", "visible": true}]
        }
    }))
    .unwrap();
    let status = ColumnId::from_uuid(Uuid::from_u128(1));
    let due = ColumnId::from_uuid(Uuid::from_u128(2));
    let doing = OptionId::from_uuid(Uuid::from_u128(3));
    let done = OptionId::from_uuid(Uuid::from_u128(4));
    let bindings = [
        ViewColumnBinding {
            property_id: "a%7D".into(),
            property_name: "Status".into(),
            column: status,
            kind: ColumnKind::Select { multi: false },
            options: BTreeMap::from([("Doing".into(), doing), ("Done".into(), done)]),
            snapshot: false,
        },
        ViewColumnBinding {
            property_id: "b%7C".into(),
            property_name: "Due".into(),
            column: due,
            kind: ColumnKind::Date,
            options: BTreeMap::new(),
            snapshot: false,
        },
    ];
    let translation = translate(&view, &bindings);
    assert_eq!(
        translation.view.query.sort,
        [
            SortKey {
                column: due,
                direction: SortDirection::Descending
            },
            SortKey {
                column: status,
                direction: SortDirection::Ascending
            },
        ]
    );
    let filter = translation.view.query.filter.unwrap();
    assert_eq!(
        filter.conditions,
        [FilterNode::Condition(FilterCondition {
            column: status,
            test: FilterTest::Options {
                operator: SetOperator::IsNoneOf,
                options: vec![done]
            },
        })]
    );
    let cell = |value| HashMap::from([(status, value)]);
    // This evaluator is for forms and excludes empty cells from negative
    // tests. The saved-view SQL paging regression covers those cells.
    assert!(eval::matches(
        &filter,
        &cell(CellValue::Options(vec![OptionRef::Id(doing)]))
    ));
    assert!(!eval::matches(
        &filter,
        &cell(CellValue::Options(vec![OptionRef::Id(done)]))
    ));
    let mut compound = view;
    compound.filter = Some(json!({"or": [
        {"property": "a}", "status": {"does_not_equal": "Done"}},
        {"property": "a}", "status": {"is_empty": true}}
    ]}));
    let filter = translate(&compound, &bindings).view.query.filter.unwrap();
    assert_eq!(filter.conjunction, Conjunction::Or);
    assert_eq!(filter.conditions.len(), 2);
    assert!(eval::matches(&filter, &HashMap::new()));
    assert!(!eval::matches(
        &filter,
        &cell(CellValue::Options(vec![OptionRef::Id(done)]))
    ));
    assert_eq!(
        translation.view.layout,
        RequestedLayout::Board {
            group_by: status,
            title: None,
            lanes: vec![
                Lane {
                    key: LaneKey::Option(doing),
                    hidden: false
                },
                Lane {
                    key: LaneKey::Option(done),
                    hidden: false
                },
            ],
            card_fields: vec![due],
            hide_empty_lanes: false,
        }
    );
    assert_eq!(translation.losses.len(), 1);
    assert_eq!(
        translation.losses[0].kind,
        ViewLossKind::FilterIncludesBlankStatus
    );
    assert!(translation.losses[0].reason.contains("blank cells"));
}

#[test]
fn decoded_binding_defers_to_exact_ids_and_rejects_ambiguous_alternates() {
    let make = |id: &str, name: &str, col: u128| ViewColumnBinding {
        property_id: id.into(),
        property_name: name.into(),
        column: ColumnId::from_uuid(Uuid::from_u128(col)),
        kind: ColumnKind::Text,
        options: BTreeMap::new(),
        snapshot: false,
    };
    let columns = [
        make("a%7D", "First", 1),
        make("a%7d", "Second", 2),
        make("other", "a}", 3),
    ];
    assert_eq!(
        super::super::model::column(&columns, "a%7d").map(|c| c.column),
        Some(columns[1].column)
    );
    assert!(super::super::model::column(&columns, "a}").is_none());
    assert_eq!(
        super::super::model::column(&columns[..1], "a}").map(|c| c.column),
        Some(columns[0].column)
    );
    assert_eq!(
        super::super::model::column(&columns, "First").map(|c| c.column),
        Some(columns[0].column)
    );
}

#[test]
fn an_exact_unimportable_property_cannot_bind_another_columns_alias() {
    use crate::domain::model::{
        NotionDataSource, NotionParent, NotionPropertyKind, NotionPropertySchema,
    };
    let view: NotionView = serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-000000000001",
        "parent": {"database_id": "00000000-0000-4000-8000-000000000002"},
        "data_source_id": "00000000-0000-4000-8000-000000000003",
        "name": "Table", "type": "table",
        "filter": {"property": "a}", "title": {"equals": "A title"}}
    }))
    .unwrap();
    let source = NotionDataSource {
        id: view.data_source_id.clone().unwrap(),
        database_id: view.parent.database_id.clone(),
        title: "Example".into(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![
            NotionPropertySchema {
                id: "a%7D".into(),
                name: "Name".into(),
                kind: NotionPropertyKind::Title,
            },
            NotionPropertySchema {
                id: "a}".into(),
                name: "Action".into(),
                kind: NotionPropertyKind::Unsupported {
                    notion_type: "button".into(),
                },
            },
        ],
    };
    let plan = crate::domain::macro_cells::ColumnPlan::new(&source, Uuid::from_u128(7));
    let columns = bindings(&source, &plan, ColumnId::from_uuid(Uuid::from_u128(1)));
    let translated = translate_with_schema(&view, &source, &columns);
    assert!(translated.view.query.filter.is_none());
    assert_eq!(translated.losses.len(), 1);
    assert_eq!(translated.losses[0].kind, ViewLossKind::Filter);
}

#[test]
fn missing_hidden_relation_reports_visibility_and_metadata_is_silent() {
    let view: NotionView = serde_json::from_value(json!({
        "id": "00000000-0000-4000-8000-000000000001",
        "parent": {"database_id": "00000000-0000-4000-8000-000000000002"},
        "data_source_id": "00000000-0000-4000-8000-000000000003",
        "name": "Table", "type": "table", "request_id": "transport-metadata",
        "configuration": {"type": "table", "properties": [
            {"property_id": "title", "property_name": "Name", "visible": true},
            {"property_id": "related", "property_name": "Relation", "visible": false}
        ]}
    }))
    .unwrap();
    let title = ViewColumnBinding {
        property_id: "title".into(),
        property_name: "Name".into(),
        column: ColumnId::from_uuid(Uuid::from_u128(1)),
        kind: ColumnKind::Text,
        options: BTreeMap::new(),
        snapshot: false,
    };
    let translated = translate(&view, &[title]);
    assert_eq!(translated.losses.len(), 1, "{:?}", translated.losses);
    assert_eq!(translated.losses[0].setting, ViewSetting::HiddenColumn);
    assert_eq!(
        translated.losses[0].path,
        "configuration.properties[1].visible"
    );
}
