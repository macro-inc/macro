use std::time::Duration;

use serde_json::json;

use super::*;

fn claude_code() -> ClientInfo {
    ClientInfo {
        name: Some("claude-code".to_owned()),
        version: Some("2.1.300".to_owned()),
        user_agent: Some("claude-code/2.1.300".to_owned()),
    }
}

#[test]
fn tool_calls_use_the_posthog_mcp_analytics_shape() {
    let telemetry = McpTelemetry::disabled();

    let event = telemetry.tool_call_event(
        "SetupGetState",
        &claude_code(),
        Duration::from_millis(42),
        &ToolCallOutcome::Success,
    );

    assert_eq!(event["$mcp_source"], json!("posthog_mcp_analytics"));
    assert_eq!(event["$mcp_server_name"], json!("macro"));
    assert_eq!(event["$mcp_tool_name"], json!("SetupGetState"));
    assert_eq!(event["$mcp_duration_ms"], json!(42));
    assert_eq!(event["$mcp_is_error"], json!(false));
    assert_eq!(event["$mcp_client_name"], json!("claude-code"));
    assert_eq!(event["$mcp_client_version"], json!("2.1.300"));
    assert!(!event.contains_key("$mcp_error_message"));
}

#[test]
fn tool_errors_carry_their_class_but_never_their_text() {
    let telemetry = McpTelemetry::disabled();

    let event = telemetry.tool_call_event(
        "SetupImport",
        &claude_code(),
        Duration::from_millis(7),
        &ToolCallOutcome::Error { kind: "tool_error" },
    );

    assert_eq!(event["$mcp_is_error"], json!(true));
    assert_eq!(event["$mcp_error_type"], json!("tool_error"));
    assert!(event.get("$mcp_error_message").is_none());
}

#[test]
fn tool_events_never_carry_arguments_or_results() {
    let telemetry = McpTelemetry::disabled();

    let event = telemetry.tool_call_event(
        "ContentSearch",
        &claude_code(),
        Duration::ZERO,
        &ToolCallOutcome::Success,
    );

    assert!(!event.contains_key("$mcp_parameters"));
    assert!(!event.contains_key("$mcp_response"));
}

#[test]
fn an_unknown_client_falls_back_to_its_user_agent_then_to_unknown() {
    let by_agent = ClientInfo {
        user_agent: Some("openai-mcp/1.0".to_owned()),
        ..ClientInfo::default()
    };
    assert_eq!(by_agent.label(), "openai-mcp/1.0");
    assert_eq!(ClientInfo::default().label(), "unknown");
}
