//! Toolset construction tests.
//!
//! Adding a tool to a toolset runs its input schema through
//! `generate_validated_input_schema` (via `AsyncToolObject::try_from_tool`),
//! which enforces the strict-mode requirements shared by OpenAI and
//! Anthropic. On a validation failure that path `.expect()`-panics, so a tool
//! with an unsupported schema (e.g. a `HashMap` that emits
//! `additionalProperties`) used to surface only at runtime when the service
//! built its toolset.
//!
//! These tests build every toolset the crate exposes. If any tool fails
//! schema validation, construction panics and the corresponding test fails —
//! turning that runtime failure into a test-time failure.

use super::*;

#[test]
fn subagent_toolset_passes_schema_validation() {
    let _ = subagent_toolset();
}

#[test]
fn all_tools_passes_schema_validation() {
    let _ = all_tools();
}

#[test]
fn mcp_tools_passes_schema_validation() {
    let _ = mcp_tools();
}

#[test]
fn no_tools_passes_schema_validation() {
    let _ = no_tools();
}

#[test]
fn search_toolset_passes_schema_validation() {
    let _ = search_toolset();
}

#[test]
fn frontend_schemas_build() {
    let _ = all_tool_frontend_schemas();
}

#[test]
fn list_entities_is_not_a_registered_tool() {
    let json = all_tool_frontend_schemas()
        .to_json_pretty()
        .expect("frontend schemas serialize");
    let schemas: serde_json::Value = serde_json::from_str(&json).expect("valid schema json");
    let names: Vec<&str> = schemas["tools"]
        .as_array()
        .expect("tools array")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert!(
        !names.contains(&"ListEntities"),
        "ListEntities must stay deleted"
    );
    assert!(names.contains(&"QuerySoup"), "QuerySoup must be registered");
    assert!(
        names.contains(&"DescribeSoup"),
        "DescribeSoup must be registered alongside QuerySoup"
    );
}

/// The QuerySoup card must stay small; the per-kind schema is fetched on
/// demand through DescribeSoup.
#[test]
fn query_soup_card_is_bounded() {
    use ai_toolset::ToolSet;
    let schemas = all_tools()
        .toolset
        .request_schemas()
        .expect("provider request schemas");
    let card = schemas
        .iter()
        .find(|schema| schema.name == "QuerySoup")
        .expect("QuerySoup request schema");
    let json = serde_json::to_string(&card.schema).expect("schema serializes");
    assert!(
        json.len() < 10_000,
        "QuerySoup request schema is {} chars",
        json.len()
    );
    assert!(
        !json.contains("input GraphqlEmailLiteral"),
        "kind literals belong in DescribeSoup slices, not the card"
    );
}

#[test]
fn frontend_schemas_distinguish_user_tool_response_types() {
    let json = all_tool_frontend_schemas()
        .to_json_pretty()
        .expect("frontend schemas serialize");
    let schemas: serde_json::Value = serde_json::from_str(&json).expect("valid schema json");
    let tools = schemas["tools"].as_array().expect("tools array");
    let output_for = |name: &str| {
        tools
            .iter()
            .find(|tool| tool["name"] == name)
            .and_then(|tool| tool["output"].as_str())
            .expect("tool output schema")
    };

    assert_eq!(
        output_for("CreateCalendarEvent"),
        "UserToolResponseForToolCalendarEvent"
    );
    assert_eq!(
        output_for("SendEmail"),
        "UserToolResponseForSendEmailResponse"
    );
}
