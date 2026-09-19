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
use ai_toolset::ToolSet as _;

#[test]
fn subagent_toolset_passes_schema_validation() {
    let _ = subagent_toolset();
}

#[test]
fn every_host_toolset_passes_schema_validation() {
    for host in [
        AiHost::Chat,
        AiHost::AgentSession,
        AiHost::ChannelBot,
        AiHost::Mcp,
    ] {
        let _ = tools_for(host);
    }
}

/// An agent session finishes user tools in the turn, so it keeps chat's
/// deferring registrations - and gets the prompt that says a review card,
/// not a pending composer, is what follows the call.
#[test]
fn the_agent_session_host_keeps_chats_user_tools_with_the_review_prompt() {
    let session = tools_for(AiHost::AgentSession);
    assert!(
        session
            .toolset
            .user_tools
            .contains_key("CreateCalendarEvent")
    );
    assert!(session.toolset.user_tools.contains_key("SendEmail"));
    let prompt = session.prompt.to_string();
    assert!(prompt.contains("review card"));
    assert!(!prompt.contains("PendingUserExecution"));
    assert_eq!(
        session
            .toolset
            .request_schemas()
            .map(|schemas| schemas.len()),
        tools_for(AiHost::Chat)
            .toolset
            .request_schemas()
            .map(|schemas| schemas.len()),
        "the same tools as chat"
    );
}

/// Hosts without a composer cannot finish a deferred user tool, so their
/// toolsets must execute calendar creation directly and never register the
/// deferring SendEmail — a `UserToolResponse` output there would mean a call
/// that nothing can ever execute. Both get CreateEmailDraft instead; only
/// the MCP server also gets the direct, opt-in-gated SendEmail.
#[test]
fn composerless_hosts_execute_directly_and_draft_instead_of_deferring() {
    for host in [AiHost::ChannelBot, AiHost::Mcp] {
        let json = frontend_schemas_builder()
            .merge(&tools_for(host))
            .build()
            .to_json_pretty()
            .expect("host schemas serialize");
        let schemas: serde_json::Value = serde_json::from_str(&json).expect("valid schema json");
        let tools = schemas["tools"].as_array().expect("tools array");

        let create = tools
            .iter()
            .find(|tool| tool["name"] == "CreateCalendarEvent")
            .expect("composer-less toolset keeps CreateCalendarEvent");
        assert_eq!(create["output"], "ToolCalendarEvent", "{host:?}");

        assert!(
            tools.iter().any(|tool| tool["name"] == "CreateEmailDraft"),
            "{host:?} toolset offers CreateEmailDraft"
        );

        let send = tools.iter().find(|tool| tool["name"] == "SendEmail");
        match host {
            AiHost::ChannelBot => {
                assert!(send.is_none(), "the channel bot must not expose SendEmail");
            }
            AiHost::Mcp => {
                let send = send.expect("the MCP server exposes a direct SendEmail");
                assert_eq!(
                    send["output"], "McpSendEmailResponse",
                    "MCP's SendEmail executes directly rather than deferring"
                );
            }
            AiHost::Chat | AiHost::AgentSession => unreachable!(),
        }
    }
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
