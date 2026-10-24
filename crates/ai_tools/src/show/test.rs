use super::view_check::{CHECKED_KEYWORDS, IGNORED_KEYWORDS, view_problems};
use super::{SCHEMA_JSON, Show, check_view};
use crate::{AiHost, tools_for};
use ai_toolset::{
    ToolSet,
    schema::{frontend_schemas_builder, generate_validated_input_schema},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn assert_local_refs_resolve(root: &Value, node: &Value) {
    match node {
        Value::Object(fields) => {
            if let Some(reference) = fields.get("$ref").and_then(Value::as_str) {
                let pointer = reference.strip_prefix('#').expect("local schema reference");
                assert!(
                    root.pointer(pointer).is_some(),
                    "unresolved reference {reference}"
                );
            }
            for child in fields.values() {
                assert_local_refs_resolve(root, child);
            }
        }
        Value::Array(items) => {
            for child in items {
                assert_local_refs_resolve(root, child);
            }
        }
        _ => {}
    }
}

#[test]
fn provider_schema_contains_the_recursive_view_contract_at_the_tool_root() {
    let validated = generate_validated_input_schema::<Show>().expect("valid schema");
    assert_eq!(validated.name, "Show");
    assert!(validated.description.contains("ReadActivity"));
    let schema = serde_json::to_value(validated.schema).expect("serialize schema");
    assert_eq!(schema["required"], json!(["view"]));
    assert_eq!(schema["properties"]["view"]["required"], json!(["widgets"]));
    assert_local_refs_resolve(&schema, &schema);

    let reference = schema["properties"]["view"]["properties"]["widgets"]["items"]["$ref"]
        .as_str()
        .expect("recursive widget reference");
    let variants = schema
        .pointer(reference.strip_prefix('#').unwrap())
        .and_then(|widget| widget["anyOf"].as_array())
        .expect("widget variants");
    let names = variants
        .iter()
        .map(|variant| variant["properties"]["type"]["const"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "md",
            "timeline",
            "list",
            "channelMessage",
            "events",
            "cards",
            "tags",
            "container"
        ]
    );
    let container = variants.last().unwrap();
    assert_eq!(
        container["properties"]["children"]["items"]["$ref"],
        reference
    );
}

#[test]
fn agent_sessions_advertise_the_same_complete_contract_as_chat() {
    for host in [AiHost::Chat, AiHost::AgentSession] {
        let toolset = tools_for(host);
        let show = toolset
            .toolset
            .request_schemas()
            .expect("request schemas")
            .into_iter()
            .find(|tool| tool.name == "Show")
            .expect("Show available");
        let schema = serde_json::to_value(show.schema).expect("serialize schema");
        assert!(schema["properties"]["view"]["properties"]["widgets"].is_object());
        assert!(schema["$defs"].is_object());
        assert_local_refs_resolve(&schema, &schema);
    }
}

#[test]
fn show_is_omitted_on_hosts_without_a_view_renderer() {
    for host in [AiHost::ChannelBot, AiHost::Mcp] {
        let toolset = tools_for(host);
        assert!(!toolset.toolset.tools.contains_key("Show"), "{host:?}");
    }

    let channel_tools = tools_for(AiHost::ChannelBot);
    assert!(channel_tools.toolset.tools.contains_key("SearchTools"));
    assert!(channel_tools.toolset.tools.contains_key("LoadTools"));
}

#[test]
fn frontend_wire_schema_leaves_view_validation_to_the_renderer() {
    let schemas = frontend_schemas_builder()
        .merge(&tools_for(AiHost::Chat))
        .build()
        .to_json_pretty()
        .expect("serialize frontend schemas");
    let schemas: Value = serde_json::from_str(&schemas).expect("frontend schemas JSON");
    let json = &schemas["$defs"]["Show"];
    assert_eq!(json["title"], "Show");
    assert_eq!(json["required"], json!(["view"]));
    assert!(json["properties"]["view"]["properties"].is_null());
    assert!(json["properties"]["view"]["type"].is_null());
    assert!(json.get("$defs").is_none());
}

const WIDGET_TYPES: &str =
    r#""md", "timeline", "list", "channelMessage", "events", "cards", "tags", "container""#;

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
            { "type": "events", "title": "This week", "events": [{ "eventId": "event-1", "occurrenceKey": "2026-10-14" }] },
            { "type": "cards", "title": "Docs", "items": [{ "type": "document", "id": "doc-1" }] },
            {
                "type": "tags",
                "title": "Engineering tags",
                "tags": [{
                    "label": "Type",
                    "description": "What kind of work it is",
                    "children": [{ "label": "bug", "color": "red", "tagId": "tag-1" }]
                }]
            },
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
fn a_view_of_every_widget_is_shown() {
    assert_eq!(view_problems(&every_widget()), Vec::<String>::new());
    assert!(check_view(&every_widget()).is_ok());
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
fn a_tags_widget_without_tags_and_a_markdown_type_are_named() {
    // The view an agent sent that rendered as "Couldn't render dashboard".
    let view = json!({
        "title": "Workspace Setup: Tags & Routines",
        "widgets": [
            { "type": "tags", "title": "Created Tags" },
            { "type": "markdown", "markdown": "### Routines Status" },
            { "type": "cards", "title": "Onboarding Summary", "items": [{ "id": "doc-1", "type": "document" }] }
        ]
    });
    assert_eq!(
        view_problems(&view),
        [
            r#"view.widgets[0] is missing "tags""#.to_owned(),
            format!("view.widgets[1].type should be one of {WIDGET_TYPES}"),
        ]
    );
}

#[test]
fn a_problem_names_its_place_in_nested_widgets_and_sources() {
    let view = json!({
        "widgets": [
            { "type": "container", "children": [{ "type": "cards", "items": [{ "type": "spaceship", "id": "s-1" }] }] },
            { "type": "tags", "tags": [{ "label": "Type", "children": [{ "color": "red" }] }] },
            { "type": "list", "source": { "kind": "ids", "entities": [] } },
            { "type": "list", "source": { "entities": [] } },
            { "title": "No type" }
        ]
    });
    assert_eq!(
        view_problems(&view),
        [
            r#"view.widgets[0].children[0].items[0].type should be one of "document", "email_thread", "calendar_event", "project", "channel", "routine", "form", "initiative""#.to_owned(),
            r#"view.widgets[1].tags[0].children[0] is missing "label""#.to_owned(),
            r#"view.widgets[2].source.kind should be one of "query", "items""#.to_owned(),
            r#"view.widgets[3].source is missing "kind", one of "query", "items""#.to_owned(),
            format!(r#"view.widgets[4] is missing "type", one of {WIDGET_TYPES}"#),
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

#[test]
fn a_view_with_problems_is_turned_back_with_what_to_fix() {
    let widgets = (0..12)
        .map(|_| json!({ "type": "chart" }))
        .collect::<Vec<_>>();
    let error = check_view(&json!({ "widgets": widgets })).expect_err("the view is turned back");
    let listed = (0..10)
        .map(|index| format!("- view.widgets[{index}].type should be one of {WIDGET_TYPES}\n"))
        .collect::<String>();
    assert_eq!(
        error.description,
        format!(
            "The view was not shown: it does not match the Show schema.\n{listed}- and 2 more\nFix these and call Show again with the whole view."
        )
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
    let schema: Value = serde_json::from_str(SCHEMA_JSON).expect("generated schema JSON");
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
