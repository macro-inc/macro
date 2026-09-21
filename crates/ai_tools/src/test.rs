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
    let tools = subagent_toolset();
    for name in [
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "CreateDatabase",
        "CreateTable",
        "AddColumn",
        "AddColumnOptions",
        "SaveDatabaseView",
    ] {
        assert!(
            tools.tools.contains_key(name),
            "delegated agents need {name}"
        );
    }
}

#[test]
fn database_only_toolset_exposes_exactly_its_eight_database_capabilities() {
    let tools = database_tools();
    let names = tools
        .tools
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let expected = [
        "ListDatabases",
        "DescribeDatabase",
        "QueryDatabase",
        "CreateDatabase",
        "CreateTable",
        "AddColumn",
        "AddColumnOptions",
        "SaveDatabaseView",
    ]
    .into_iter()
    .collect();
    assert_eq!(names, expected);
    assert!(
        tools.user_tools.is_empty(),
        "database actions must not expose email/calendar composers"
    );
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

#[test]
fn document_answers_expose_only_discovery_and_read_only_query() {
    let tools = database_read_only_tools();
    let names = tools
        .tools
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(
        names,
        ["ListDatabases", "DescribeDatabase", "QueryDatabase"]
            .into_iter()
            .collect()
    );
    assert!(tools.user_tools.is_empty());
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
/// toolsets must execute calendar creation directly and omit SendEmail
/// entirely — a `UserToolResponse` output there would mean a call that
/// nothing can ever execute.
#[test]
fn composerless_hosts_execute_calendar_create_directly_and_omit_send_email() {
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
            !tools.iter().any(|tool| tool["name"] == "SendEmail"),
            "{host:?} toolset must not expose SendEmail"
        );
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
