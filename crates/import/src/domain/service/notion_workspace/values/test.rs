use std::collections::BTreeMap;

use chrono::{TimeZone, Utc};
use import_notion::domain::macro_cells::Person;
use import_notion::domain::model::{NotionId, NotionParent};

use super::*;

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
