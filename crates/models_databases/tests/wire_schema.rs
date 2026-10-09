//! The OpenAPI schema names the fields serde actually writes. utoipa reads
//! some serde attributes and not others (it ignores `rename_all_fields`), so
//! a sample of every op, result and view, and of every change nested in
//! them, is serialized and walked against the schema it claims.

use chrono::{TimeZone, Utc};
use models_databases::views::{
    CardPosition, Conjunction, DatabaseView, DateOperator, FilterCondition, FilterGroup,
    FilterNode, FilterTest, Lane, LaneKey, NewView, NumberOperator, PresenceOperator,
    RequestedLayout, SetOperator, SortDirection, SortKey, TextOperator, ViewColumn, ViewLayout,
    ViewPosition, ViewQuery,
};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnId, ColumnKind, ColumnResult, DatabaseId, DatabaseOp,
    EntityKind, EntityRef, Formula, NewColumn, NewOption, OpResult, Operator, OptionId, OptionRef,
    PropertyId, RowChange, RowChanges, RowId, RowsChange, RowsResult, TableChange, TableId,
    TableResult, TableVersion, VersionedTable, ViewChange, ViewId, ViewResult,
};
use serde_json::{Map, Value};
use utoipa::OpenApi;
use uuid::Uuid;

#[derive(OpenApi)]
#[openapi(components(schemas(
    DatabaseOp,
    TableChange,
    ColumnChange,
    RowsChange,
    ViewChange,
    OpResult,
    TableResult,
    ColumnResult,
    RowsResult,
    ViewResult,
)))]
struct Schemas;

const DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb));
const TABLE: TableId = TableId::from_uuid(Uuid::from_u128(0x7ab1));
const VIEW: ViewId = ViewId::from_uuid(Uuid::from_u128(0x71e3));
const STATUS: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc01b));
const NAME: ColumnId = ColumnId::from_uuid(Uuid::from_u128(0xc01a));
const ROW: RowId = RowId::from_uuid(Uuid::from_u128(0x5a11));
const OTHER_ROW: RowId = RowId::from_uuid(Uuid::from_u128(0xa1e8));
const DONE: OptionId = OptionId::from_uuid(Uuid::from_u128(0xd0e));
const PROPERTY: PropertyId = PropertyId::from_uuid(Uuid::from_u128(0x9e0));

fn every_filter_test() -> FilterGroup {
    let tests = vec![
        FilterTest::Presence {
            operator: PresenceOperator::IsEmpty,
        },
        FilterTest::Text {
            operator: TextOperator::Contains,
            value: "Sam".into(),
        },
        FilterTest::Number {
            operator: NumberOperator::GreaterThan,
            value: 2.5,
        },
        FilterTest::Date {
            operator: DateOperator::Before,
            value: Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap(),
        },
        FilterTest::Checkbox { checked: true },
        FilterTest::Options {
            operator: SetOperator::IsAnyOf,
            options: vec![DONE],
        },
        FilterTest::Entities {
            operator: SetOperator::HasAll,
            entities: vec!["doc".into()],
        },
    ];
    FilterGroup {
        conjunction: Conjunction::And,
        conditions: vec![FilterNode::Group(FilterGroup {
            conjunction: Conjunction::Or,
            conditions: tests
                .into_iter()
                .map(|test| FilterNode::Condition(FilterCondition { column: NAME, test }))
                .collect(),
        })],
    }
}

fn board() -> ViewLayout {
    ViewLayout::Board {
        group_by: STATUS,
        title: NAME,
        lanes: vec![
            Lane {
                key: LaneKey::Option(DONE),
                hidden: false,
            },
            Lane {
                key: LaneKey::None,
                hidden: true,
            },
        ],
        card_fields: vec![NAME],
        hide_empty_lanes: true,
    }
}

fn table_layout() -> ViewLayout {
    ViewLayout::Table {
        columns: vec![ViewColumn {
            column: NAME,
            width: Some(120),
        }],
    }
}

fn query() -> ViewQuery {
    ViewQuery {
        filter: Some(every_filter_test()),
        sort: vec![SortKey {
            column: NAME,
            direction: SortDirection::Descending,
        }],
    }
}

fn every_cell_value() -> Vec<CellWrite> {
    [
        CellValue::Text("Sam".into()),
        CellValue::Number(2.5),
        CellValue::Boolean(true),
        CellValue::Date(Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap()),
        CellValue::Link(vec!["https://macro.com".into()]),
        CellValue::Options(vec![OptionRef::Id(DONE), OptionRef::Label("Going".into())]),
        CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::CallRecord,
            entity_id: "call".into(),
        }]),
        CellValue::Rows(vec![ROW]),
        CellValue::Clear,
    ]
    .into_iter()
    .map(|value| CellWrite {
        column: NAME,
        value,
    })
    .collect()
}

fn ops() -> Vec<DatabaseOp> {
    let table = |change| DatabaseOp::Table {
        table: TABLE,
        change,
    };
    let column = |change| DatabaseOp::Column {
        table: TABLE,
        column: STATUS,
        change,
    };
    let rows = |change| DatabaseOp::Rows {
        table: TABLE,
        change,
    };
    let view = |change| DatabaseOp::View {
        table: TABLE,
        view: VIEW,
        change,
    };
    let mut ops = vec![
        table(TableChange::Create {
            name: "Guests".into(),
        }),
        table(TableChange::Rename {
            name: "People".into(),
            previous_name: Some("Guests".into()),
        }),
        table(TableChange::Rename {
            name: "People".into(),
            previous_name: None,
        }),
        table(TableChange::Delete),
        table(TableChange::ReorderColumns {
            order: vec![STATUS, NAME],
        }),
        table(TableChange::ReorderViews { order: vec![VIEW] }),
        DatabaseOp::ReorderTables { order: vec![TABLE] },
        DatabaseOp::ReorderTables { order: vec![] },
        column(ColumnChange::Create {
            definition: NewColumn::New {
                name: "Status".into(),
                kind: ColumnKind::Select { multi: false },
                options: vec![NewOption {
                    id: DONE,
                    label: "Done".into(),
                }],
                infer_type: false,
            },
            after: Some(NAME),
        }),
        column(ColumnChange::Create {
            definition: NewColumn::New {
                name: "Name".into(),
                kind: ColumnKind::Text,
                options: vec![],
                infer_type: true,
            },
            after: None,
        }),
        column(ColumnChange::Create {
            definition: NewColumn::Existing { property: PROPERTY },
            after: None,
        }),
        column(ColumnChange::Create {
            definition: NewColumn::Derived {
                name: "Total".into(),
                formula: every_formula(),
            },
            after: Some(NAME),
        }),
        column(ColumnChange::SetFormula {
            formula: every_formula(),
        }),
        column(ColumnChange::Rename {
            name: "Title".into(),
            previous_name: Some("Name".into()),
        }),
        column(ColumnChange::Rename {
            name: "Title".into(),
            previous_name: None,
        }),
        column(ColumnChange::Delete),
        column(ColumnChange::AddOptions {
            options: vec![NewOption {
                id: DONE,
                label: "Done".into(),
            }],
        }),
        column(ColumnChange::UpdateOption {
            option: DONE,
            label: Some("Done".into()),
            color: Some(Some("#0091FF".into())),
        }),
        column(ColumnChange::UpdateOption {
            option: DONE,
            label: None,
            color: Some(None),
        }),
        column(ColumnChange::UpdateOption {
            option: DONE,
            label: None,
            color: None,
        }),
        column(ColumnChange::DeleteOption { option: DONE }),
        rows(RowsChange::Insert {
            rows: vec![every_cell_value()],
        }),
        rows(RowsChange::Update {
            changes: RowChanges::Uniform {
                rows: vec![ROW],
                cells: every_cell_value(),
            },
        }),
        rows(RowsChange::Update {
            changes: RowChanges::PerRow {
                rows: vec![RowChange {
                    row: ROW,
                    cells: every_cell_value(),
                }],
            },
        }),
        rows(RowsChange::Delete { rows: vec![ROW] }),
        view(ViewChange::Create {
            view: NewView {
                name: "Board".into(),
                query: query(),
                layout: RequestedLayout::Board {
                    group_by: STATUS,
                    title: None,
                    lanes: vec![],
                    card_fields: vec![NAME],
                    hide_empty_lanes: false,
                },
            },
        }),
        view(ViewChange::Create {
            view: NewView {
                name: "Grid".into(),
                query: ViewQuery::default(),
                layout: table_layout().into(),
            },
        }),
        view(ViewChange::Update {
            name: Some("Grid".into()),
            query: Some(query()),
            layout: Some(table_layout().into()),
        }),
        view(ViewChange::Update {
            name: None,
            query: None,
            layout: Some(board().into()),
        }),
        view(ViewChange::Update {
            name: None,
            query: None,
            layout: None,
        }),
        view(ViewChange::Delete),
        view(ViewChange::MoveCard {
            row: ROW,
            lane: LaneKey::Option(DONE),
            before: Some(OTHER_ROW),
            after: None,
        }),
        view(ViewChange::MoveCard {
            row: ROW,
            lane: LaneKey::None,
            before: None,
            after: Some(OTHER_ROW),
        }),
        view(ViewChange::MoveCard {
            row: ROW,
            lane: LaneKey::None,
            before: None,
            after: None,
        }),
        view(ViewChange::MoveCard {
            row: ROW,
            lane: LaneKey::User("macro|sam@macro.com".try_into().unwrap()),
            before: None,
            after: None,
        }),
    ];
    let kinds = [
        ColumnKind::Text,
        ColumnKind::Number,
        ColumnKind::Boolean,
        ColumnKind::Date,
        ColumnKind::Link,
        ColumnKind::Select { multi: true },
        ColumnKind::SelectNumber { multi: false },
        ColumnKind::Tag,
        ColumnKind::Entity {
            target: EntityKind::Task,
            multi: true,
        },
        ColumnKind::Relation {
            database: DATABASE,
            table: TABLE,
        },
    ];
    ops.extend(
        kinds
            .into_iter()
            .map(|to| column(ColumnChange::ChangeType { to })),
    );
    ops
}

fn stored_view() -> Box<DatabaseView> {
    let at = Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap();
    Box::new(DatabaseView {
        id: VIEW,
        database_id: DATABASE,
        table_id: TABLE,
        name: "Board".into(),
        position: "80".parse().unwrap(),
        query: query(),
        layout: board(),
        created_at: at,
        updated_at: at,
    })
}

fn results() -> Vec<OpResult> {
    let version = TableVersion(7);
    let table = |table_version, change| OpResult::Table {
        table: TABLE,
        table_version,
        change,
    };
    let column = |change| OpResult::Column {
        table: TABLE,
        column: NAME,
        table_version: version,
        change,
    };
    let rows = |change| OpResult::Rows {
        table: TABLE,
        table_version: version,
        change,
    };
    let view = |change| OpResult::View {
        table: TABLE,
        view: VIEW,
        table_version: version,
        change,
    };
    vec![
        table(Some(version), TableResult::Created),
        table(Some(version), TableResult::Renamed),
        table(None, TableResult::Deleted),
        table(Some(version), TableResult::ColumnsReordered),
        table(
            Some(version),
            TableResult::ViewsReordered {
                positions: vec![ViewPosition {
                    view: VIEW,
                    position: "80".parse().unwrap(),
                }],
            },
        ),
        OpResult::ReorderTables {
            tables: vec![VersionedTable {
                table: TABLE,
                version,
            }],
        },
        column(ColumnResult::Created),
        column(ColumnResult::Renamed),
        column(ColumnResult::TypeChanged),
        column(ColumnResult::Deleted),
        column(ColumnResult::OptionsAdded { added: vec![DONE] }),
        column(ColumnResult::OptionsAdded { added: vec![] }),
        column(ColumnResult::OptionUpdated),
        column(ColumnResult::OptionDeleted),
        column(ColumnResult::FormulaSet),
        rows(RowsResult::Inserted { rows: vec![ROW] }),
        rows(RowsResult::Updated { affected: 1 }),
        rows(RowsResult::Deleted { affected: 2 }),
        view(ViewResult::Created {
            view: stored_view(),
        }),
        view(ViewResult::Updated {
            view: stored_view(),
        }),
        view(ViewResult::Deleted),
        view(ViewResult::CardMoved {
            positions: vec![
                CardPosition {
                    row: ROW,
                    lane: LaneKey::Option(DONE),
                    position: "80".parse().unwrap(),
                },
                CardPosition {
                    row: OTHER_ROW,
                    lane: LaneKey::None,
                    position: "8180".parse().unwrap(),
                },
            ],
        }),
    ]
}

/// Why `value` is not what `schema` describes, by field name: an object's
/// keys must be the schema's properties, its required ones all present.
fn mismatch(
    value: &Value,
    schema: &Value,
    components: &Map<String, Value>,
    path: &str,
) -> Option<String> {
    if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
        let name = reference.trim_start_matches("#/components/schemas/");
        return mismatch(value, &components[name], components, path);
    }
    for combinator in ["oneOf", "anyOf"] {
        if let Some(alternatives) = schema.get(combinator).and_then(Value::as_array) {
            let reasons: Vec<String> = alternatives
                .iter()
                .filter_map(|alternative| mismatch(value, alternative, components, path))
                .collect();
            return (reasons.len() == alternatives.len())
                .then(|| format!("{path}: no alternative fits: {}", reasons.join("; ")));
        }
    }
    if let Some(parts) = schema.get("allOf").and_then(Value::as_array) {
        return parts
            .iter()
            .find_map(|part| mismatch(value, part, components, path));
    }
    match value {
        Value::Null => {
            let nullable = schema["type"] == "null"
                || schema["type"]
                    .as_array()
                    .is_some_and(|types| types.contains(&Value::from("null")));
            (!nullable).then(|| format!("{path}: null where the schema allows none"))
        }
        Value::Array(items) => items.iter().enumerate().find_map(|(index, item)| {
            mismatch(
                item,
                &schema["items"],
                components,
                &format!("{path}[{index}]"),
            )
        }),
        Value::Object(fields) => {
            let properties = schema["properties"].as_object()?;
            if let Some(unknown) = fields.keys().find(|key| !properties.contains_key(*key)) {
                return Some(format!(
                    "{path}: `{unknown}` is not among the schema's {:?}",
                    properties.keys().collect::<Vec<_>>()
                ));
            }
            let required = schema["required"].as_array().cloned().unwrap_or_default();
            if let Some(missing) = required
                .iter()
                .filter_map(Value::as_str)
                .find(|key| !fields.contains_key(*key))
            {
                return Some(format!("{path}: required `{missing}` is not written"));
            }
            fields.iter().find_map(|(key, field)| {
                mismatch(
                    field,
                    &properties[key],
                    components,
                    &format!("{path}.{key}"),
                )
            })
        }
        scalar => {
            let allowed = schema.get("enum").and_then(Value::as_array)?;
            (!allowed.contains(scalar))
                .then(|| format!("{path}: {scalar} is not among the schema's {allowed:?}"))
        }
    }
}

/// The discriminators of a tagged enum's schema, one per variant: the
/// single `kind` each alternative of its `oneOf` allows.
fn kinds(schema: &Value) -> Vec<String> {
    let mut kinds: Vec<String> = schema["oneOf"]
        .as_array()
        .unwrap()
        .iter()
        .map(|variant| {
            variant["properties"]["kind"]["enum"][0]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    kinds.sort();
    kinds
}

/// The schema of `component`'s variant whose `kind` is `kind`.
fn variant<'schema>(component: &'schema Value, kind: &str) -> &'schema Value {
    component["oneOf"]
        .as_array()
        .unwrap()
        .iter()
        .find(|variant| variant["properties"]["kind"]["enum"][0] == kind)
        .unwrap_or_else(|| panic!("no `{kind}` variant"))
}

/// Every outer `kind` of `component` and, below each outer one carrying a
/// `change`, every inner `kind` of its change's schema, appears among
/// `samples`.
fn assert_every_kind_sampled(component: &str, samples: &[Value]) {
    let components = components();
    let outer = &components[component];
    let mut sampled: Vec<String> = samples
        .iter()
        .map(|sample| sample["kind"].as_str().unwrap().to_owned())
        .collect();
    sampled.sort();
    sampled.dedup();
    assert_eq!(sampled, kinds(outer), "{component}");
    for kind in kinds(outer) {
        let Some(change) = variant(outer, &kind)["properties"].get("change") else {
            continue;
        };
        let reference = change["$ref"]
            .as_str()
            .unwrap_or_else(|| panic!("{component} {kind}: `change` is not a reference"));
        let change = reference.trim_start_matches("#/components/schemas/");
        let mut sampled: Vec<String> = samples
            .iter()
            .filter(|sample| sample["kind"] == kind.as_str())
            .map(|sample| sample["change"]["kind"].as_str().unwrap().to_owned())
            .collect();
        sampled.sort();
        sampled.dedup();
        assert_eq!(
            sampled,
            kinds(&components[change]),
            "{component} {kind}: {change}"
        );
    }
}

/// `-(Name + 2) * Name`: every kind of formula node.
fn every_formula() -> Formula {
    Formula::Binary {
        operator: Operator::Multiply,
        left: Box::new(Formula::Negate {
            operand: Box::new(Formula::Binary {
                operator: Operator::Add,
                left: Box::new(Formula::Column { column: NAME }),
                right: Box::new(Formula::Number { value: 2.0 }),
            }),
        }),
        right: Box::new(Formula::Column { column: NAME }),
    }
}

fn components() -> Map<String, Value> {
    let openapi = serde_json::to_value(Schemas::openapi()).unwrap();
    openapi["components"]["schemas"]
        .as_object()
        .unwrap()
        .clone()
}

#[test]
fn every_op_writes_the_fields_its_schema_names() {
    let components = components();
    for op in ops() {
        let value = serde_json::to_value(&op).unwrap();
        if let Some(reason) = mismatch(&value, &components["DatabaseOp"], &components, "op") {
            panic!("{reason}\nin {value:#}");
        }
    }
}

#[test]
fn every_result_writes_the_fields_its_schema_names() {
    let components = components();
    for result in results() {
        let value = serde_json::to_value(&result).unwrap();
        if let Some(reason) = mismatch(&value, &components["OpResult"], &components, "result") {
            panic!("{reason}\nin {value:#}");
        }
    }
}

#[test]
fn a_board_names_its_fields_in_camel_case() {
    let components = components();
    let board = serde_json::to_value(board()).unwrap();
    assert_eq!(board["groupBy"], Value::from(STATUS.to_string()));
    assert_eq!(board["hideEmptyLanes"], Value::from(true));
    assert!(mismatch(&board, &components["ViewLayout"], &components, "board").is_none());
}

#[test]
fn a_card_move_may_leave_out_where_it_lands() {
    let components = components();
    let move_card = variant(&components["ViewChange"], "move_card");
    let required: Vec<&str> = move_card["required"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert!(!required.contains(&"before"), "{required:?}");
    assert!(!required.contains(&"after"), "{required:?}");
    assert!(required.contains(&"lane"), "{required:?}");
}

#[test]
fn the_samples_cover_every_op_and_change() {
    let samples: Vec<Value> = ops()
        .iter()
        .map(|op| serde_json::to_value(op).unwrap())
        .collect();
    assert_every_kind_sampled("DatabaseOp", &samples);
}

#[test]
fn the_samples_cover_every_result_and_change() {
    let samples: Vec<Value> = results()
        .iter()
        .map(|result| serde_json::to_value(result).unwrap())
        .collect();
    assert_every_kind_sampled("OpResult", &samples);
}

#[test]
fn a_wrong_inner_kind_is_a_mismatch() {
    let components = components();
    let op = serde_json::json!({
        "kind": "table",
        "table": TABLE,
        "change": {"kind": "change_type", "to": {"type": "text"}},
    });
    assert!(mismatch(&op, &components["DatabaseOp"], &components, "op").is_some());
}
