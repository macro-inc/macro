//! Filters must retain rows after the importer's text normalization.

use super::*;
use crate::domain::macro_cells::{ColumnPlan, PeopleMap};
use crate::domain::model::{
    NotionDataSource, NotionId, NotionPage, NotionParent, NotionPropertyKind, NotionPropertySchema,
};
use models_databases::CellValue;
use std::collections::HashMap;

#[test]
fn padded_title_filters_preserve_the_rows_written_by_the_importer() {
    let source = NotionDataSource {
        id: NotionId::parse("00000000000040008000000000000003").unwrap(),
        database_id: NotionId::parse("00000000000040008000000000000002").unwrap(),
        title: "Work".into(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![NotionPropertySchema {
            id: "title".into(),
            name: "Name".into(),
            kind: NotionPropertyKind::Title,
        }],
    };
    let mut row = NotionPage {
        id: NotionId::parse("00000000000040008000000000000004").unwrap(),
        title: " padded ".into(),
        url: "https://www.notion.so/00000000000040008000000000000004".into(),
        parent: NotionParent::DataSource {
            data_source: source.id.clone(),
            database: source.database_id.clone(),
        },
        last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
        created: "2026-11-17T00:00:00Z".parse().unwrap(),
        in_trash: false,
        properties: Default::default(),
    };
    let title = ColumnId::from_uuid(Uuid::from_u128(10));
    let plan = ColumnPlan::new(&source, Uuid::from_u128(11));
    let columns = bindings(&source, &plan, title);
    let cells: HashMap<_, _> = plan
        .row_cells(&row, title, &PeopleMap::new())
        .into_iter()
        .map(|cell| (cell.column, cell.value))
        .collect();
    assert_eq!(cells[&title], CellValue::Text("padded".into()));
    let mut view: NotionView = serde_json::from_value(json!({
        "parent":{"database_id":"00000000-0000-4000-8000-000000000002"},
        "id":"00000000-0000-4000-8000-000000000001", "name":"Padded title", "type":"table",
        "data_source_id":"00000000-0000-4000-8000-000000000003"
    }))
    .unwrap();
    for operator in ["equals", "contains", "starts_with", "ends_with"] {
        view.filter = Some(json!({"property":"title", "title":{(operator):" padded "}}));
        let translated = translate(&view, &columns);
        let filter = translated
            .view
            .query
            .filter
            .as_ref()
            .expect("positive predicates remain supported");
        assert!(
            eval::matches(filter, &cells),
            "a padded Notion title matching {operator} must remain visible"
        );
        assert!(!eval::matches(
            filter,
            &HashMap::from([(title, CellValue::Text("other".into()))])
        ));
        assert!(
            translated
                .losses
                .iter()
                .any(|loss| loss.kind == ViewLossKind::Filter)
        );
    }
    for (operator, literal) in [
        ("does_not_equal", "padded"),
        ("does_not_equal", " padded "),
        ("does_not_contain", " other "),
    ] {
        view.filter = Some(json!({"property":"title", "title":{(operator):literal}}));
        let translated = translate(&view, &columns);
        assert!(
            translated.view.query.filter.is_none(),
            "unsafe {operator} on {literal:?} must not hide normalized rows"
        );
        assert!(
            translated
                .losses
                .iter()
                .any(|loss| loss.kind == ViewLossKind::Filter)
        );
    }
    view.filter = Some(json!({"property":"title", "title":{"does_not_contain":"other"}}));
    let translated = translate(&view, &columns);
    assert!(eval::matches(
        translated.view.query.filter.as_ref().unwrap(),
        &cells
    ));
    assert!(
        translated.losses.is_empty(),
        "unchanged does-not-contain remains exact"
    );

    row.title = "   ".into();
    let blank_cells: HashMap<_, _> = plan
        .row_cells(&row, title, &PeopleMap::new())
        .into_iter()
        .map(|cell| (cell.column, cell.value))
        .collect();
    assert!(
        blank_cells.is_empty(),
        "whitespace-only imported titles are null"
    );
    for operator in ["equals", "contains", "starts_with", "ends_with"] {
        view.filter = Some(json!({"property":"title", "title":{(operator):"   "}}));
        let translated = translate(&view, &columns);
        assert!(translated.view.query.filter.is_none());
        assert!(
            translated
                .losses
                .iter()
                .any(|loss| loss.kind == ViewLossKind::Filter)
        );
    }
    view.filter = Some(json!({"property":"title", "title":{"is_not_empty":true}}));
    let translated = translate(&view, &columns);
    assert!(
        translated.view.query.filter.is_none(),
        "source whitespace is nonempty but imports as null"
    );
    assert!(
        translated
            .losses
            .iter()
            .any(|loss| loss.kind == ViewLossKind::Filter)
    );
    view.filter = Some(json!({"property":"title", "title":{"is_empty":true}}));
    let translated = translate(&view, &columns);
    assert!(eval::matches(
        translated.view.query.filter.as_ref().unwrap(),
        &blank_cells
    ));
    assert!(translated.losses.is_empty());
}
