use super::*;
use serde_json::json;

fn request_parts(
    headers: &[(&str, &str)],
    auth_method: Option<McpAuthMethod>,
) -> http::request::Parts {
    let mut builder = http::Request::builder().uri("/mcp").method("POST");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    let (mut parts, ()) = builder.body(()).unwrap().into_parts();
    if let Some(auth_method) = auth_method {
        parts.extensions.insert(auth_method);
    }
    parts
}

fn properties(
    event: &McpAnalyticsEvent,
    client: &McpClientSignals,
    environment: Environment,
    team_id: Option<uuid::Uuid>,
) -> serde_json::Value {
    serde_json::to_value(ProductEventProperties::new(
        EventProperties::new(event, client),
        environment,
        team_id,
    ))
    .unwrap()
}

#[test]
fn client_signals_read_headers_and_auth_method() {
    let parts = request_parts(
        &[
            ("user-agent", "claude-code/2.1.0 (cli)"),
            ("x-anthropic-client", "ClaudeCode"),
            ("mcp-protocol-version", "2025-06-18"),
        ],
        Some(McpAuthMethod::ApiKey),
    );

    let signals = McpClientSignals::from_request_parts(Some(&parts));

    assert_eq!(
        serde_json::to_value(&signals).unwrap(),
        json!({
            "$mcp_client_user_agent": "claude-code/2.1.0 (cli)",
            "$mcp_vendor_client": "ClaudeCode",
            "$mcp_protocol_version": "2025-06-18",
            "$mcp_auth_method": "api_key",
        })
    );
}

#[test]
fn client_signals_truncate_long_headers_and_skip_blank_ones() {
    let long_agent = "a".repeat(1000);
    let parts = request_parts(
        &[
            ("user-agent", long_agent.as_str()),
            ("x-anthropic-client", "  "),
        ],
        None,
    );

    let signals = McpClientSignals::from_request_parts(Some(&parts));

    assert_eq!(
        serde_json::to_value(&signals).unwrap(),
        json!({ "$mcp_client_user_agent": "a".repeat(256) })
    );
}

#[test]
fn client_signals_are_empty_without_request_parts() {
    assert_eq!(
        McpClientSignals::from_request_parts(None),
        McpClientSignals::default()
    );
}

#[test]
fn successful_tool_call_records_name_timing_and_team_only() {
    let team_id = uuid::Uuid::parse_str("7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f").unwrap();
    let client = McpClientSignals::from_request_parts(Some(&request_parts(
        &[("user-agent", "openai-mcp/1.0.0")],
        Some(McpAuthMethod::OAuth),
    )));
    let event = McpAnalyticsEvent::ToolCall {
        tool_name: "ContentSearch".to_owned(),
        outcome: ToolCallOutcome::Success,
        duration: Duration::from_millis(1234),
    };

    assert_eq!(
        properties(&event, &client, Environment::Production, Some(team_id)),
        json!({
            "$mcp_tool_name": "ContentSearch",
            "$mcp_is_error": false,
            "$mcp_duration_ms": 1234,
            "$mcp_client_user_agent": "openai-mcp/1.0.0",
            "$mcp_auth_method": "oauth",
            "$mcp_server_name": "macro-tools",
            "$mcp_server_version": env!("CARGO_PKG_VERSION"),
            "env": "PROD",
            "macro_environment": "prod",
            "team_id": "7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f",
            "$groups": { "team": "7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f" },
        })
    );
}

#[test]
fn failed_tool_calls_use_posthogs_error_buckets() {
    for (outcome, error_type) in [
        (ToolCallOutcome::InvalidRequest, Some("validation")),
        (ToolCallOutcome::ToolError, None),
    ] {
        let event = McpAnalyticsEvent::ToolCall {
            tool_name: "EditDocument".to_owned(),
            outcome,
            duration: Duration::from_millis(5),
        };

        let value = properties(
            &event,
            &McpClientSignals::default(),
            Environment::Develop,
            None,
        );

        assert_eq!(value["$mcp_is_error"], json!(true));
        assert_eq!(
            value.get("$mcp_error_type"),
            error_type.map(|t| json!(t)).as_ref()
        );
        assert_eq!(value["env"], json!("DEV"));
        assert!(value.get("$groups").is_none());
        assert!(value.get("team_id").is_none());
    }
}

#[test]
fn a_cached_team_is_reused_until_it_expires() {
    let cache = TeamCache::new(10);
    let user = MacroUserIdStr::parse_from_str("macro|user-1@example.com").unwrap();
    let team_id = uuid::Uuid::parse_str("7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f").unwrap();
    let read_at = Instant::now();

    cache.put(user.clone(), Some(team_id), read_at);

    assert_eq!(
        cache.get(&user, read_at + Duration::from_secs(9 * 60)),
        Some(Some(team_id))
    );
    assert_eq!(
        cache.get(&user, read_at + Duration::from_secs(10 * 60)),
        None
    );
    assert_eq!(cache.get(&user, read_at), None);
}

#[test]
fn users_without_a_team_are_cached_as_teamless() {
    let cache = TeamCache::new(10);
    let user = MacroUserIdStr::parse_from_str("macro|user-1@example.com").unwrap();
    let read_at = Instant::now();

    cache.put(user.clone(), None, read_at);

    assert_eq!(cache.get(&user, read_at), Some(None));
}

#[test]
fn initialize_records_client_info_and_negotiated_protocol_version() {
    let client = McpClientSignals::from_request_parts(Some(&request_parts(
        &[
            ("user-agent", "Claude-User"),
            ("mcp-protocol-version", "2024-11-05"),
        ],
        Some(McpAuthMethod::OAuth),
    )));
    let event = McpAnalyticsEvent::Initialize {
        client_name: "claude-ai".to_owned(),
        client_version: "0.1.0".to_owned(),
        protocol_version: "2025-06-18".to_owned(),
    };

    assert_eq!(
        properties(&event, &client, Environment::Production, None),
        json!({
            "$mcp_client_name": "claude-ai",
            "$mcp_client_version": "0.1.0",
            "$mcp_protocol_version": "2025-06-18",
            "$mcp_client_user_agent": "Claude-User",
            "$mcp_auth_method": "oauth",
            "$mcp_server_name": "macro-tools",
            "$mcp_server_version": env!("CARGO_PKG_VERSION"),
            "env": "PROD",
            "macro_environment": "prod",
        })
    );
}
