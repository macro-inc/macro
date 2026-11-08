use std::collections::BTreeMap;

use chrono::TimeZone;
use import_notion::domain::model::{NotionOption, NotionParent};
use macro_user_id::cowlike::CowLike;

use super::*;

fn option(name: &str) -> NotionOption {
    NotionOption {
        id: format!("id-{name}"),
        name: name.to_string(),
        color: "blue".to_string(),
    }
}

fn row(properties: Vec<(&str, NotionValue)>) -> NotionPage {
    NotionPage {
        id: NotionId::parse("3fb607323e2e80629886fc0c028d50a7").unwrap(),
        title: "Ship the importer".to_string(),
        url: "https://www.notion.so/3fb607323e2e80629886fc0c028d50a7".to_string(),
        parent: NotionParent::Workspace,
        last_edited: Utc.with_ymd_and_hms(2026, 10, 1, 9, 0, 0).unwrap(),
        created: Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap(),
        in_trash: false,
        properties: properties
            .into_iter()
            .map(|(name, value)| (name.to_string(), value))
            .collect::<BTreeMap<_, _>>(),
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
fn a_page_keeps_its_tags_and_typed_properties_as_document_properties() {
    let page = row(vec![
        (
            "Tags",
            NotionValue::Options(vec!["roadmap".to_string(), "q3".to_string()]),
        ),
        ("Reviewed", NotionValue::Checkbox(true)),
        ("Effort", NotionValue::Number(3.0)),
        (
            "Due",
            NotionValue::Date {
                start: "2026-10-01".to_string(),
                end: None,
            },
        ),
        ("Area", NotionValue::Option("Infra".to_string())),
        (
            "Spec",
            NotionValue::Url("https://acme.test/spec".to_string()),
        ),
        ("Notes", NotionValue::Text("Ask legal".to_string())),
        ("Related", NotionValue::Relation(Vec::new())),
    ]);

    let properties = document_properties(&page);

    assert_eq!(properties.tags, ["q3", "roadmap"]);
    assert_eq!(
        properties.values,
        vec![
            ImportedDocumentProperty {
                name: "Area".to_string(),
                value: ImportedDocumentPropertyValue::Select {
                    values: vec!["Infra".to_string()],
                    multi: false,
                },
            },
            ImportedDocumentProperty {
                name: "Due".to_string(),
                value: ImportedDocumentPropertyValue::Date {
                    value: "2026-10-01".to_string(),
                },
            },
            ImportedDocumentProperty {
                name: "Effort".to_string(),
                value: ImportedDocumentPropertyValue::Number { value: 3.0 },
            },
            ImportedDocumentProperty {
                name: "Notes".to_string(),
                value: ImportedDocumentPropertyValue::String {
                    value: "Ask legal".to_string(),
                },
            },
            ImportedDocumentProperty {
                name: "Reviewed".to_string(),
                value: ImportedDocumentPropertyValue::Boolean { value: true },
            },
            ImportedDocumentProperty {
                name: "Spec".to_string(),
                value: ImportedDocumentPropertyValue::Link {
                    urls: vec!["https://acme.test/spec".to_string()],
                    multi: false,
                },
            },
        ]
    );
}

#[test]
fn a_task_list_row_maps_its_named_columns_onto_task_fields_and_keeps_the_rest_in_the_body() {
    let alice = NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
    let people: PeopleMap = [(
        alice.clone(),
        Person {
            email: Some("alice@acme.test".to_string()),
            macro_user: None,
        },
    )]
    .into_iter()
    .collect();
    let task = row(vec![
        ("Stage", NotionValue::Option("In progress".to_string())),
        ("Urgency", NotionValue::Option("High".to_string())),
        (
            "Deadline",
            NotionValue::Date {
                start: "2026-11-02T17:00:00.000Z".to_string(),
                end: None,
            },
        ),
        ("Owner", NotionValue::People(vec![alice])),
        ("Sprint", NotionValue::Option("Sprint 12".to_string())),
    ]);
    let fields = NotionTaskFields {
        status: Some("Stage".to_string()),
        priority: Some("Urgency".to_string()),
        due: Some("Deadline".to_string()),
        assignee: Some("Owner".to_string()),
    };

    assert_eq!(
        task_properties(&task, &fields, &people),
        ImportedTaskProperties {
            status: Some("In Progress".to_string()),
            priority: Some("High".to_string()),
            due_date: Some("2026-11-02".to_string()),
            assignee_email: Some("alice@acme.test".to_string()),
        }
    );
    assert_eq!(
        task_body(&task, "Pair with Bo on the parser.", &fields, &people),
        "Pair with Bo on the parser.\n\n---\n\n- **Sprint:** Sprint 12"
    );
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
