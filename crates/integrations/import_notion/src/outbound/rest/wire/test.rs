use std::collections::BTreeMap;

use chrono::{TimeZone, Utc};

use super::{WireDataSource, WirePage};
use crate::domain::model::{
    NotionDataSource, NotionFile, NotionId, NotionOption, NotionPage, NotionParent,
    NotionPropertyKind, NotionPropertySchema, NotionValue,
};

#[test]
fn a_page_with_every_property_type_flattens_into_values() {
    let page: WirePage =
        serde_json::from_str(include_str!("../../../../fixtures/page.json")).unwrap();

    let owner = NotionId::parse("ee5f0f84-409a-440f-983a-a5315961c6e4").unwrap();
    assert_eq!(
        page.into_page(),
        NotionPage {
            id: NotionId::parse("598337872cf94fdf8782e53db20768a5").unwrap(),
            title: "Launch plan".into(),
            url: "https://www.notion.so/Launch-plan-598337872cf94fdf8782e53db20768a5".into(),
            parent: NotionParent::DataSource {
                data_source: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
                database: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
            },
            last_edited: Utc.with_ymd_and_hms(2026, 3, 2, 10, 15, 0).unwrap(),
            created: Utc.with_ymd_and_hms(2026, 3, 1, 9, 30, 0).unwrap(),
            in_trash: false,
            properties: BTreeMap::from([
                ("Notes".into(), NotionValue::Text("Ship it".into())),
                ("Empty notes".into(), NotionValue::Empty),
                ("Budget".into(), NotionValue::Number(1250.5)),
                ("No budget".into(), NotionValue::Empty),
                ("Priority".into(), NotionValue::Option("High".into())),
                ("No priority".into(), NotionValue::Empty),
                (
                    "Tags".into(),
                    NotionValue::Options(vec!["web".into(), "ios".into()]),
                ),
                ("Status".into(), NotionValue::Option("In progress".into())),
                (
                    "Due".into(),
                    NotionValue::Date {
                        start: "2026-04-01".into(),
                        end: Some("2026-04-03".into()),
                    },
                ),
                ("Owner".into(), NotionValue::People(vec![owner.clone()])),
                (
                    "Attachments".into(),
                    NotionValue::Files(vec![
                        NotionFile {
                            name: "spec.pdf".into(),
                            url: "https://prod-files.notion-static.com/spec.pdf".into(),
                            expires: Some(Utc.with_ymd_and_hms(2026, 3, 2, 11, 15, 0).unwrap()),
                        },
                        NotionFile {
                            name: "mock".into(),
                            url: "https://example.com/mock.png".into(),
                            expires: None,
                        },
                    ]),
                ),
                ("Done".into(), NotionValue::Checkbox(true)),
                ("Link".into(), NotionValue::Url("https://macro.com".into())),
                (
                    "Contact".into(),
                    NotionValue::Email("team@example.com".into())
                ),
                ("Phone".into(), NotionValue::Empty),
                (
                    "Projects".into(),
                    NotionValue::Relation(vec![
                        NotionId::parse("a1b2c3d4-0000-4000-8000-000000000001").unwrap()
                    ]),
                ),
                ("Score".into(), NotionValue::Number(42.0)),
                ("Label".into(), NotionValue::Text("high-42".into())),
                ("Total".into(), NotionValue::Number(7.0)),
                (
                    "Project names".into(),
                    NotionValue::List(vec![NotionValue::Text("Alpha".into())]),
                ),
                (
                    "Created".into(),
                    NotionValue::Timestamp("2026-03-01T09:30:00.000Z".into()),
                ),
                (
                    "Created by".into(),
                    NotionValue::People(vec![owner.clone()])
                ),
                (
                    "Edited".into(),
                    NotionValue::Timestamp("2026-03-02T10:15:00.000Z".into()),
                ),
                ("Edited by".into(), NotionValue::People(vec![owner])),
                ("Ticket".into(), NotionValue::UniqueId("TASK-42".into())),
                ("Run".into(), NotionValue::Empty),
                ("Verified".into(), NotionValue::Empty),
            ]),
        }
    );
}

#[test]
fn a_data_source_schema_keeps_notion_column_order_and_configuration() {
    let source: WireDataSource =
        serde_json::from_str(include_str!("../../../../fixtures/data_source.json")).unwrap();

    assert_eq!(
        source.into_data_source().unwrap(),
        NotionDataSource {
            id: NotionId::parse("1a44be1209534631a1d67d4c2b1b4a2f").unwrap(),
            database_id: NotionId::parse("d9824bdc84454327be8b5b47500af6ce").unwrap(),
            title: "Roadmap".into(),
            database_parent: NotionParent::Page {
                id: NotionId::parse("c7f0aa501f0e4a529a17e2f6f3a3b0c1").unwrap(),
            },
            in_trash: false,
            properties: vec![
                NotionPropertySchema {
                    id: "title".into(),
                    name: "Name".into(),
                    kind: NotionPropertyKind::Title,
                },
                NotionPropertySchema {
                    id: "pR".into(),
                    name: "Priority".into(),
                    kind: NotionPropertyKind::Select {
                        options: vec![
                            NotionOption {
                                id: "o1".into(),
                                name: "High".into(),
                                color: "red".into(),
                            },
                            NotionOption {
                                id: "o2".into(),
                                name: "Low".into(),
                                color: "green".into(),
                            },
                        ],
                    },
                },
                NotionPropertySchema {
                    id: "sT".into(),
                    name: "Status".into(),
                    kind: NotionPropertyKind::Status {
                        options: vec![NotionOption {
                            id: "s1".into(),
                            name: "In progress".into(),
                            color: "blue".into(),
                        }],
                    },
                },
                NotionPropertySchema {
                    id: "pJ".into(),
                    name: "Projects".into(),
                    kind: NotionPropertyKind::Relation {
                        data_source_id: Some(
                            NotionId::parse("bbbb0000-0000-4000-8000-000000000000").unwrap()
                        ),
                    },
                },
                NotionPropertySchema {
                    id: "tK".into(),
                    name: "Ticket".into(),
                    kind: NotionPropertyKind::UniqueId {
                        prefix: Some("TASK".into()),
                    },
                },
                NotionPropertySchema {
                    id: "bU".into(),
                    name: "Budget".into(),
                    kind: NotionPropertyKind::Number,
                },
                NotionPropertySchema {
                    id: "rN".into(),
                    name: "Run".into(),
                    kind: NotionPropertyKind::Unsupported {
                        notion_type: "button".into(),
                    },
                },
            ],
        }
    );
}

#[test]
fn a_data_source_outside_a_database_is_unreadable() {
    let source: WireDataSource = serde_json::from_value(serde_json::json!({
        "object": "data_source",
        "id": "1a44be12-0953-4631-a1d6-7d4c2b1b4a2f",
        "parent": {"type": "workspace", "workspace": true},
        "properties": {}
    }))
    .unwrap();

    assert_eq!(
        source.into_data_source(),
        Err("data source 1a44be1209534631a1d67d4c2b1b4a2f is not under a database".into())
    );
}
