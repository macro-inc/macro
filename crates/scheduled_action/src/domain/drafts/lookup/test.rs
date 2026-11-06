use serde_json::{Value, json};

use super::*;

fn found(kind: &str, name: &str, matches: Value) -> Found {
    serde_json::from_value(json!({ "kind": kind, "name": name, "matches": matches })).unwrap()
}

#[test]
fn a_name_means_the_one_item_called_that() {
    let workspace = resolve(&[
        found(
            "channel",
            "#Bug-Reports",
            json!([
                { "name": "bug-reports-archive", "id": "c1" },
                { "name": "bug-reports", "id": "c2" },
            ]),
        ),
        found(
            "tag",
            "urgent",
            json!([{ "name": "Urgent", "id": "o1", "definitionId": "d1" }]),
        ),
        found(
            "label",
            "Finance",
            json!([{ "name": "Finance", "id": "l1" }]),
        ),
    ]);

    assert_eq!(
        workspace,
        Workspace {
            email_labels: vec!["Finance".into()],
            tags: vec![WorkspaceTag {
                label: "Urgent".into(),
                definition_id: "d1".into(),
                option_id: "o1".into(),
            }],
            channels: vec![NamedItem {
                name: "bug-reports".into(),
                id: "c2".into(),
            }],
            ..Default::default()
        }
    );
}

#[test]
fn an_ambiguous_or_unknown_name_stays_unresolved() {
    let workspace = resolve(&[
        // Two channels with the same name: the person picks.
        found(
            "channel",
            "eng",
            json!([{ "name": "eng", "id": "c1" }, { "name": "Eng", "id": "c2" }]),
        ),
        // Only a longer name: not the channel they named.
        found(
            "channel",
            "bug-reports",
            json!([{ "name": "bug-reports-archive", "id": "c3" }]),
        ),
        found("folder", "Q3 plans", json!([])),
        found(
            "person",
            "sam",
            json!([{ "name": "Sam Lee", "id": "u1" }, { "name": "Sam Ortiz", "id": "u2" }]),
        ),
        // A longer name that merely contains it is someone else.
        found("person", "sam", json!([{ "name": "Samir", "id": "u3" }])),
    ]);

    assert_eq!(workspace, Workspace::default());
}

#[test]
fn a_person_is_found_by_first_name_or_email() {
    let workspace = resolve(&[
        found(
            "person",
            "@sam",
            json!([
                { "name": "Sam Lee", "id": "macro|sam@example.com" },
                { "name": "Samir Khan", "id": "macro|samir@example.com" },
            ]),
        ),
        found(
            "person",
            "dana@example.com",
            json!([{ "name": "Dana Park", "id": "macro|dana@example.com" }]),
        ),
    ]);

    assert_eq!(
        workspace.people,
        vec![
            NamedItem {
                name: "Sam Lee".into(),
                id: "macro|sam@example.com".into(),
            },
            NamedItem {
                name: "Dana Park".into(),
                id: "macro|dana@example.com".into(),
            },
        ]
    );
}
