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
