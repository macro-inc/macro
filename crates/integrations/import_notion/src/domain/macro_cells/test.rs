use std::collections::BTreeMap;

use chrono::TimeZone;
use macro_user_id::cowlike::CowLike;

use super::*;
use crate::domain::model::{NotionOption, NotionParent};

fn option(name: &str) -> NotionOption {
    NotionOption {
        id: format!("id-{name}"),
        name: name.to_string(),
        color: "blue".to_string(),
    }
}

#[test]
fn a_status_column_becomes_a_select_and_its_cells_point_at_the_planned_options() {
    let property = NotionPropertySchema {
        id: "stat".to_string(),
        name: "Status".to_string(),
        kind: NotionPropertyKind::Status {
            options: vec![option("Not started"), option("In progress"), option("Done")],
        },
    };

    let column = planned_column(
        &property,
        &ColumnNames::new(std::slice::from_ref(&property)),
        Uuid::from_u128(500),
    )
    .unwrap();
    assert_eq!(
        planned_column(
            &property,
            &ColumnNames::new(std::slice::from_ref(&property)),
            Uuid::from_u128(500)
        )
        .unwrap(),
        column,
        "writing the same database again names the same column and options"
    );
    assert_ne!(
        planned_column(
            &property,
            &ColumnNames::new(std::slice::from_ref(&property)),
            Uuid::from_u128(501)
        )
        .unwrap()
        .id,
        column.id
    );

    let ColumnShape::Select { multi, options } = &column.shape else {
        panic!("expected a select, got {:?}", column.shape);
    };
    assert!(!multi);
    let labels: Vec<&str> = options.iter().map(|(_, label)| label.as_str()).collect();
    assert_eq!(labels, ["Not started", "In progress", "Done"]);
    assert_eq!(column.name, "Status");
    assert_eq!(column.shape.kind(), ColumnKind::Select { multi: false });

    let in_progress = options[1].0;
    assert_eq!(
        cell(
            &NotionValue::Option("in progress".to_string()),
            &column,
            &PeopleMap::new()
        ),
        Some(CellValue::Options(vec![OptionRef::Id(in_progress)]))
    );
    assert_eq!(
        cell(
            &NotionValue::Option("Blocked".to_string()),
            &column,
            &PeopleMap::new()
        ),
        None,
        "a label Notion never declared has no option to point at"
    );
}

#[test]
fn columns_take_the_closest_macro_type_and_titles_and_relations_wait() {
    let kinds = [
        (NotionPropertyKind::Title, None),
        (
            NotionPropertyKind::Relation {
                data_source_id: None,
            },
            None,
        ),
        (
            NotionPropertyKind::Unsupported {
                notion_type: "button".to_string(),
            },
            None,
        ),
        (NotionPropertyKind::RichText, Some(ColumnKind::Text)),
        (NotionPropertyKind::Formula, Some(ColumnKind::Text)),
        (NotionPropertyKind::Email, Some(ColumnKind::Text)),
        (NotionPropertyKind::Files, Some(ColumnKind::Text)),
        (NotionPropertyKind::Number, Some(ColumnKind::Number)),
        (NotionPropertyKind::Checkbox, Some(ColumnKind::Boolean)),
        (NotionPropertyKind::Date, Some(ColumnKind::Date)),
        (NotionPropertyKind::CreatedTime, Some(ColumnKind::Date)),
        (NotionPropertyKind::Url, Some(ColumnKind::Link)),
        (
            NotionPropertyKind::MultiSelect {
                options: vec![option("a")],
            },
            Some(ColumnKind::Select { multi: true }),
        ),
        (
            NotionPropertyKind::People,
            Some(ColumnKind::Entity {
                target: EntityKind::User,
                multi: true,
            }),
        ),
        (
            NotionPropertyKind::CreatedBy,
            Some(ColumnKind::Entity {
                target: EntityKind::User,
                multi: false,
            }),
        ),
    ];
    for (kind, expected) in kinds {
        let property = NotionPropertySchema {
            id: "p".to_string(),
            name: "Column".to_string(),
            kind: kind.clone(),
        };
        assert_eq!(
            planned_column(
                &property,
                &ColumnNames::new(std::slice::from_ref(&property)),
                Uuid::from_u128(500)
            )
            .map(|column| column.shape.kind()),
            expected,
            "{kind:?}"
        );
    }
}

#[test]
fn people_cells_hold_only_notion_users_matched_to_team_members() {
    let alice = NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
    let outsider = NotionId::parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").unwrap();
    let alice_user = MacroUserIdStr::parse_from_str("macro|alice@acme.test")
        .unwrap()
        .into_owned();
    let people: PeopleMap = [
        (
            alice.clone(),
            Person {
                email: Some("alice@acme.test".to_string()),
                macro_user: Some(alice_user),
            },
        ),
        (
            outsider.clone(),
            Person {
                email: Some("guest@elsewhere.test".to_string()),
                macro_user: None,
            },
        ),
    ]
    .into_iter()
    .collect();
    let owner = NotionPropertySchema {
        id: "own".to_string(),
        name: "Owner".to_string(),
        kind: NotionPropertyKind::People,
    };
    let column = planned_column(
        &owner,
        &ColumnNames::new(std::slice::from_ref(&owner)),
        Uuid::from_u128(500),
    )
    .unwrap();

    assert_eq!(
        cell(
            &NotionValue::People(vec![alice, outsider]),
            &column,
            &people
        ),
        Some(CellValue::Entities(vec![EntityRef {
            entity_type: EntityKind::User,
            entity_id: "macro|alice@acme.test".to_string(),
        }]))
    );
}

#[test]
fn dates_and_timestamps_become_instants_and_bare_dates_are_midnight_utc() {
    assert_eq!(
        date(&NotionValue::Date {
            start: "2026-09-15".to_string(),
            end: None,
        }),
        Some(Utc.with_ymd_and_hms(2026, 9, 15, 0, 0, 0).unwrap())
    );
    assert_eq!(
        date(&NotionValue::Timestamp(
            "2026-09-15T14:30:00.000Z".to_string()
        )),
        Some(Utc.with_ymd_and_hms(2026, 9, 15, 14, 30, 0).unwrap())
    );
    assert_eq!(date(&NotionValue::Text("next week".to_string())), None);
}

#[test]
fn text_snapshots_render_every_value_a_reader_would_recognize() {
    assert_eq!(text(&NotionValue::Number(16.0)), Some("16".to_string()));
    assert_eq!(text(&NotionValue::Number(2.5)), Some("2.5".to_string()));
    assert_eq!(
        text(&NotionValue::Options(vec![
            "Q3".to_string(),
            "Infra".to_string()
        ])),
        Some("Q3, Infra".to_string())
    );
    assert_eq!(
        text(&NotionValue::Date {
            start: "2026-09-01".to_string(),
            end: Some("2026-09-05".to_string()),
        }),
        Some("2026-09-01 → 2026-09-05".to_string())
    );
    assert_eq!(text(&NotionValue::Checkbox(true)), Some("Yes".to_string()));
    assert_eq!(text(&NotionValue::Text("   ".to_string())), None);
    assert_eq!(text(&NotionValue::Empty), None);
}

#[test]
fn blank_property_names_become_untitled_columns_distinct_from_the_others() {
    let property = |id: &str, name: &str, kind| NotionPropertySchema {
        id: id.to_string(),
        name: name.to_string(),
        kind,
    };
    let properties = vec![
        property("title", "Name", NotionPropertyKind::Title),
        property("empty", "", NotionPropertyKind::RichText),
        property("spaces", "   ", NotionPropertyKind::Number),
        property("taken", "untitled", NotionPropertyKind::Checkbox),
    ];

    let names = ColumnNames::new(&properties);
    let columns: Vec<String> = properties
        .iter()
        .filter_map(|property| planned_column(property, &names, Uuid::from_u128(500)))
        .map(|column| column.name)
        .collect();

    assert_eq!(columns, ["Untitled 2", "Untitled 3", "untitled"]);
    assert_eq!(
        ColumnNames::new(&properties),
        names,
        "a resumed write names the blank columns the same way"
    );
}

#[test]
fn a_data_source_plans_its_columns_creates_them_after_the_title_and_fills_a_rows_cells() {
    let source = NotionDataSource {
        id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
        database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
        title: "Roadmap".to_string(),
        database_parent: NotionParent::Workspace,
        in_trash: false,
        properties: vec![
            NotionPropertySchema {
                id: "title".to_string(),
                name: "Name".to_string(),
                kind: NotionPropertyKind::Title,
            },
            NotionPropertySchema {
                id: "stat".to_string(),
                name: "Status".to_string(),
                kind: NotionPropertyKind::Status {
                    options: vec![option("Doing"), option("Done")],
                },
            },
            NotionPropertySchema {
                id: "rel".to_string(),
                name: "Projects".to_string(),
                kind: NotionPropertyKind::Relation {
                    data_source_id: None,
                },
            },
            NotionPropertySchema {
                id: "pts".to_string(),
                name: "Points".to_string(),
                kind: NotionPropertyKind::Number,
            },
        ],
    };
    let database = Uuid::from_u128(500);
    let table = TableId::from_uuid(Uuid::from_u128(600));
    let title_column = ColumnId::from_uuid(Uuid::from_u128(700));

    let plan = ColumnPlan::new(&source, database);

    assert_eq!(
        plan,
        ColumnPlan::new(&source, database),
        "planning again names the same ids"
    );
    let status = ColumnId::from_uuid(derived_id(database, "column/stat"));
    let points = ColumnId::from_uuid(derived_id(database, "column/pts"));
    let doing = OptionId::from_uuid(derived_id(database, "option/stat/Doing"));
    let done = OptionId::from_uuid(derived_id(database, "option/stat/Done"));
    assert_eq!(
        plan,
        ColumnPlan {
            title: Some("Name".to_string()),
            columns: vec![
                PlannedColumn {
                    id: status,
                    property: "Status".to_string(),
                    name: "Status".to_string(),
                    shape: ColumnShape::Select {
                        multi: false,
                        options: vec![(doing, "Doing".to_string()), (done, "Done".to_string())],
                    },
                },
                PlannedColumn {
                    id: points,
                    property: "Points".to_string(),
                    name: "Points".to_string(),
                    shape: ColumnShape::Number,
                },
            ],
        }
    );

    assert_eq!(
        plan.column_ops(table, title_column),
        vec![
            DatabaseOp::Column {
                table,
                column: title_column,
                change: ColumnChange::Rename {
                    name: "Name".to_string(),
                    previous_name: None,
                },
            },
            DatabaseOp::Column {
                table,
                column: status,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Status".to_string(),
                        kind: ColumnKind::Select { multi: false },
                        options: vec![
                            NewOption {
                                id: doing,
                                label: "Doing".to_string(),
                            },
                            NewOption {
                                id: done,
                                label: "Done".to_string(),
                            },
                        ],
                        infer_type: false,
                    },
                    after: Some(title_column),
                },
            },
            DatabaseOp::Column {
                table,
                column: points,
                change: ColumnChange::Create {
                    definition: NewColumn::New {
                        name: "Points".to_string(),
                        kind: ColumnKind::Number,
                        options: Vec::new(),
                        infer_type: false,
                    },
                    after: Some(status),
                },
            },
        ]
    );

    let row = NotionPage {
        id: NotionId::parse("3fb607323e2e80629886fc0c028d50a7").unwrap(),
        title: "  Ship the importer ".to_string(),
        url: "https://www.notion.so/3fb607323e2e80629886fc0c028d50a7".to_string(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
        in_trash: false,
        properties: BTreeMap::from([
            (
                "Status".to_string(),
                NotionValue::Option("done".to_string()),
            ),
            ("Points".to_string(), NotionValue::Empty),
            (
                "Projects".to_string(),
                NotionValue::Relation(vec![
                    NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
                ]),
            ),
        ]),
    };
    assert_eq!(
        plan.row_cells(&row, title_column, &PeopleMap::new()),
        vec![
            CellWrite {
                column: title_column,
                value: CellValue::Text("Ship the importer".to_string()),
            },
            CellWrite {
                column: status,
                value: CellValue::Options(vec![OptionRef::Id(done)]),
            },
        ],
        "an empty value leaves its cell empty and relations wait for every table"
    );
}
