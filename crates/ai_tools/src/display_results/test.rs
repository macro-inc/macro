use super::DisplayResults;
use crate::{AiHost, tools_for};
use ai_toolset::{
    ToolSet,
    schema::{frontend_schemas_builder, generate_validated_input_schema},
};
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
        ["md", "timeline", "list", "channelMessage", "container"]
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
}

#[test]
fn display_results_is_omitted_on_hosts_without_a_view_renderer() {
    for host in [AiHost::ChannelBot, AiHost::Mcp] {
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
fn frontend_wire_schema_leaves_view_validation_to_the_renderer() {
    let schemas = frontend_schemas_builder()
        .merge(&tools_for(AiHost::Chat))
        .build()
        .to_json_pretty()
        .expect("serialize frontend schemas");
    let schemas: Value = serde_json::from_str(&schemas).expect("frontend schemas JSON");
    let json = &schemas["$defs"]["DisplayResults"];
    assert_eq!(json["title"], "DisplayResults");
    assert_eq!(json["required"], json!(["view"]));
    assert!(json["properties"]["view"]["properties"].is_null());
    assert!(json["properties"]["view"]["type"].is_null());
    assert!(json.get("$defs").is_none());
}
