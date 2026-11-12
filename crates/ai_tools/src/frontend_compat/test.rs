use super::*;
use ai_toolset::schema::{PhantomTool, frontend_schemas_builder};
use properties::inbound::toolset::ToolEntityType;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[expect(dead_code, reason = "schema only: a retired tool never runs")]
struct RetiredExampleInput {
    entity_type: ToolEntityType,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RetiredExampleOutput {
    summary: String,
}

fn schema_json(builder: ai_toolset::schema::FrontendSchemasBuilder) -> Value {
    let json = builder.build().to_json_pretty().expect("schemas serialize");
    serde_json::from_str(&json).expect("schemas are JSON")
}

#[test]
fn legacy_definitions_build_without_any_tool() {
    let schema = schema_json(frontend_schemas_builder().merge(&LegacyConversationSchemas));
    let defs = &schema["$defs"];
    assert!(
        defs["ToolEntityType"]["enum"]
            .as_array()
            .expect("entity enum")
            .contains(&json!("chat"))
    );
    assert!(defs["EntityItem"]["oneOf"].as_array().is_some());
    assert_eq!(schema["tools"], json!([]));
}

#[test]
fn a_tool_registered_only_as_a_phantom_keeps_its_schema() {
    let schema = schema_json(
        frontend_schemas_builder()
            .merge(&PhantomTool::<RetiredExampleInput, RetiredExampleOutput>::new("RetiredExample"))
            .merge(&LegacyConversationSchemas),
    );
    assert_eq!(
        schema["tools"],
        json!([{
            "name": "RetiredExample",
            "input": "RetiredExampleInput",
            "output": "RetiredExampleOutput",
        }])
    );
    assert_eq!(
        schema["$defs"]["RetiredExampleInput"]["properties"]["entityType"]["$ref"],
        json!("#/$defs/ToolEntityType")
    );
    assert_eq!(
        schema["$defs"]["RetiredExampleOutput"]["required"],
        json!(["summary"])
    );
}

#[test]
fn retired_tools_are_generated_but_no_host_offers_them() {
    let mut generator = SchemaGenerator::default();
    let retired: Vec<String> = RetiredTools
        .register_schemas(&mut generator)
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    assert_eq!(retired, ["ReadChat", "ReadThread"]);

    let json = crate::all_tool_frontend_schemas()
        .to_json_pretty()
        .expect("schemas serialize");
    let generated: Value = serde_json::from_str(&json).expect("schemas are JSON");
    let hosts = [
        crate::tools_for(crate::AiHost::Chat),
        crate::tools_for(crate::AiHost::AgentSession),
        crate::tools_for(crate::AiHost::ChannelBot),
        crate::tools_for(crate::AiHost::Mcp),
        crate::tools_for_agent_code_mode(),
    ];
    for name in &retired {
        assert!(
            generated["tools"]
                .as_array()
                .expect("tool entries")
                .iter()
                .any(|tool| tool["name"] == json!(name)),
            "{name} keeps its frontend schema"
        );
        for host in &hosts {
            assert!(!host.toolset.tools.contains_key(name), "{name}");
            assert!(
                !host.deferred.iter().any(|tool| &tool.name == name),
                "{name}"
            );
        }
        assert!(
            !crate::subagent_toolset().tools.contains_key(name),
            "{name}"
        );
        assert!(!crate::database_tools().tools.contains_key(name), "{name}");
    }
}
