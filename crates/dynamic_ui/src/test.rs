use crate::PRESENT_VIEW_SCHEMA_JSON;
use crate::check::{CHECKED_KEYWORDS, IGNORED_KEYWORDS};
use crate::view_problems;
use serde_json::{Value, json};
use std::collections::BTreeSet;

const WIDGET_TYPES: &str = r#""md", "timeline", "list", "channelMessage", "container""#;

/// One of every widget, with every field the schema names.
fn every_widget() -> Value {
    json!({
        "title": "Everything",
        "widgets": [
            { "type": "md", "markdown": "**Shipped** the agenda." },
            {
                "type": "timeline",
                "title": "Today",
                "events": [{
                    "time": "9:00am",
                    "title": "Standup",
                    "description": "Daily",
                    "entity": { "id": "doc-1", "type": "document" },
                    "future": true
                }]
            },
            {
                "type": "list",
                "title": "Initiatives",
                "source": { "kind": "items", "entities": [{ "id": "init-1", "type": "initiative" }] },
                "groupBy": "project",
                "limit": 5
            },
            { "type": "list", "source": { "kind": "query", "query": { "include": { "documentId": ["doc-1"] } } } },
            { "type": "channelMessage", "channelId": "channel-1", "messageId": "message-1" },
            {
                "type": "container",
                "direction": "row",
                "gap": 2,
                "wrap": false,
                "align": "start",
                "justify": "between",
                "title": "Side by side",
                "children": [
                    { "type": "md", "markdown": "Left" },
                    { "type": "container", "children": [{ "type": "md", "markdown": "Nested" }] }
                ]
            }
        ]
    })
}

#[test]
fn a_view_of_every_widget_has_no_problems() {
    assert_eq!(view_problems(&every_widget()), Vec::<String>::new());
}

#[test]
fn fields_the_schema_does_not_name_are_ignored_as_the_renderer_ignores_them() {
    let view = json!({
        "title": "Notes",
        "theme": "dark",
        "widgets": [{ "type": "md", "markdown": "Hi", "style": { "bold": true } }]
    });
    assert_eq!(view_problems(&view), Vec::<String>::new());
}

#[test]
fn a_markdown_type_and_a_list_without_a_source_are_named() {
    // The renderer showed "Couldn't render dashboard" for views like this.
    let view = json!({
        "title": "Workspace setup",
        "widgets": [
            { "type": "markdown", "markdown": "### Routines" },
            { "type": "list", "title": "Created docs" }
        ]
    });
    assert_eq!(
        view_problems(&view),
        [
            format!("view.widgets[0].type should be one of {WIDGET_TYPES}"),
            r#"view.widgets[1] is missing "source""#.to_owned(),
        ]
    );
}

#[test]
fn a_problem_names_its_place_in_nested_widgets_and_sources() {
    let view = json!({
        "widgets": [
            { "type": "container", "children": [{ "type": "channelMessage", "channelId": "channel-1" }] },
            { "type": "list", "source": { "kind": "ids", "entities": [] } },
            { "type": "list", "source": { "entities": [] } },
            { "title": "No type" }
        ]
    });
    assert_eq!(
        view_problems(&view),
        [
            r#"view.widgets[0].children[0] is missing "messageId""#.to_owned(),
            r#"view.widgets[1].source.kind should be one of "query", "items""#.to_owned(),
            r#"view.widgets[2].source is missing "kind", one of "query", "items""#.to_owned(),
            format!(r#"view.widgets[3] is missing "type", one of {WIDGET_TYPES}"#),
        ]
    );
}

#[test]
fn a_wrong_type_says_what_belongs_there_without_repeating_the_view() {
    let view = json!({
        "title": null,
        "widgets": [
            { "type": "md", "markdown": 42 },
            "private text",
            { "type": "container", "gap": "private gap", "children": {} }
        ]
    });
    let problems = view_problems(&view);
    assert_eq!(
        problems,
        [
            "view.title should be a string, not null",
            "view.widgets[0].markdown should be a string, not a number",
            "view.widgets[1] should be an object, not a string",
            "view.widgets[2].gap should be a number, not a string",
            "view.widgets[2].children should be an array, not an object",
        ]
    );
    assert!(problems.iter().all(|problem| !problem.contains("private")));
    assert_eq!(
        view_problems(&json!(r#"{"widgets": []}"#)),
        ["view should be an object, not a string"]
    );
}

/// Every keyword a schema node uses, skipping the names of properties and
/// definitions and the values `const`, `enum` and `required` hold.
fn keywords(node: &Value, found: &mut BTreeSet<String>) {
    match node {
        Value::Object(fields) => {
            for (keyword, child) in fields {
                found.insert(keyword.clone());
                match keyword.as_str() {
                    "properties" | "$defs" => {
                        for schema in child.as_object().into_iter().flat_map(|map| map.values()) {
                            keywords(schema, found);
                        }
                    }
                    "const" | "enum" | "required" => {}
                    _ => keywords(child, found),
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                keywords(item, found);
            }
        }
        _ => {}
    }
}

#[test]
fn the_view_check_reads_every_keyword_the_generated_schema_uses() {
    let schema: Value =
        serde_json::from_str(PRESENT_VIEW_SCHEMA_JSON).expect("generated schema JSON");
    let mut found = BTreeSet::new();
    keywords(&schema, &mut found);
    let known = CHECKED_KEYWORDS
        .iter()
        .chain(IGNORED_KEYWORDS)
        .map(|keyword| (*keyword).to_owned())
        .collect::<BTreeSet<_>>();
    let unread = found.difference(&known).collect::<Vec<_>>();
    assert!(
        unread.is_empty(),
        "teach the view check {unread:?}, or it lets through views the renderer rejects"
    );
}
