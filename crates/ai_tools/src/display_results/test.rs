use super::DisplayResults;
use crate::{AiHost, tools_for};
use ai_toolset::{ToolSet, schema::generate_validated_input_schema};
use serde_json::{Value, json};

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
    let validated = generate_validated_input_schema::<DisplayResults>().expect("valid schema");
    assert_eq!(validated.name, "DisplayResults");
    assert!(validated.description.contains("ReadActivity"));
    let schema = serde_json::to_value(validated.schema).expect("serialize schema");
    assert_eq!(schema["required"], json!(["view"]));
    assert_eq!(schema["properties"]["view"]["required"], json!(["widgets"]));
    assert_local_refs_resolve(&schema, &schema);

    let variants = schema["properties"]["view"]["properties"]["widgets"]["items"]["anyOf"]
        .as_array()
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
            "botCredential",
            "container"
        ]
    );
    let children = &variants[8]["properties"]["children"]["items"]["$ref"];
    assert!(
        children.is_string(),
        "a container's children refer back to the widget"
    );
}

#[test]
fn chat_advertises_the_complete_contract() {
    let toolset = tools_for(AiHost::Chat);
    let display = toolset
        .toolset
        .request_schemas()
        .expect("request schemas")
        .into_iter()
        .find(|tool| tool.name == "DisplayResults")
        .expect("DisplayResults available");
    let schema = serde_json::to_value(display.schema).expect("serialize schema");
    assert!(schema["properties"]["view"]["properties"]["widgets"].is_object());
    assert!(schema["$defs"].is_object());
    assert_local_refs_resolve(&schema, &schema);
}

#[test]
fn display_results_is_chat_only() {
    // Agent sessions present views with the harness's execution.views.present instead.
    for host in [AiHost::AgentSession, AiHost::ChannelBot, AiHost::Mcp] {
        let toolset = tools_for(host);
        assert!(
            !toolset.toolset.tools.contains_key("DisplayResults"),
            "{host:?}"
        );
    }

    let channel_tools = tools_for(AiHost::ChannelBot);
    assert!(channel_tools.toolset.tools.contains_key("SearchTools"));
    assert!(channel_tools.toolset.tools.contains_key("LoadTools"));
}

#[test]
fn a_view_that_does_not_decode_fails_the_call_without_echoing_it() {
    let error = serde_json::from_value::<DisplayResults>(json!({
        "view": { "widgets": [{ "type": "md", "markdown": "private text" }, { "type": "chart" }] }
    }))
    .expect_err("an unknown widget type");
    assert_eq!(
        error.to_string(),
        "view.widgets[1].type should be one of `md`, `timeline`, `list`, `channelMessage`, `events`, `cards`, `tags`, `botCredential`, `container`"
    );
}
