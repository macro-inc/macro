use super::*;

fn urls() -> ComputerUrls {
    ComputerUrls {
        git: AgentGitServiceUrl::from_static("http://git:8080"),
        gateway: ApiGatewayUrl::from_static("http://proxy:8112"),
        egress: AgentHarnessEgressUrl::from_static("http://harness:8102"),
        storage: DocumentStorageServiceUrl::from_static("http://storage:8080"),
        auth: AuthServiceUrl::from_static("http://auth:8080"),
        cognition: DocumentCognitionServiceUrl::from_static("http://harness:8080/cognition"),
        agent_harness: AgentHarnessServiceUrl::from_static("http://harness:8080"),
        scheduled_action: ScheduledActionServiceUrl::from_static("http://scheduled:8080"),
        connection: ConnectionGatewayWebsocketUrl::from_static("ws://connection:8080/ws"),
        mcp: McpServiceUrl::from_static("http://harness:8080"),
    }
}

#[test]
fn canonical_seven_service_urls_are_transient_and_mcp_remains_a_base() {
    let env = urls().persona_env().unwrap();
    for (key, value) in [
        (
            "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
            "http://storage:8080",
        ),
        ("OVERRIDE_AUTH_SERVICE_URL", "http://auth:8080"),
        (
            "OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL",
            "http://harness:8080/cognition",
        ),
        ("OVERRIDE_AGENT_HARNESS_SERVICE_URL", "http://harness:8080"),
        (
            "OVERRIDE_SCHEDULED_ACTION_SERVICE_URL",
            "http://scheduled:8080",
        ),
        (
            "OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL",
            "ws://connection:8080/ws",
        ),
        ("OVERRIDE_MCP_SERVICE_URL", "http://harness:8080"),
        ("MACRO_GATEWAY", "http://proxy:8112"),
        ("ANTHROPIC_BASE_URL", "http://harness:8102/brain/anthropic"),
    ] {
        assert_eq!(env.as_map().get(key).map(String::as_str), Some(value));
    }
    assert_eq!(env.as_map().len(), 9);
}

#[test]
fn local_loopback_and_invalid_protocols_are_rejected_before_issuance() {
    for raw in [
        "http://localhost:8090",
        "https://preview.localhost:8090",
        "http://127.0.0.1:8090",
        "http://[::1]:8090",
        "http://0.0.0.0:8090",
        "http://user:pass@harness",
        "http://harness/?token=bad",
    ] {
        let mut resolved = urls();
        resolved.gateway = ApiGatewayUrl::from_owned(raw);
        assert!(resolved.persona_env().is_err());
    }
    let mut resolved = urls();
    resolved.connection = ConnectionGatewayWebsocketUrl::from_static("http://connection:8080/ws");
    assert!(resolved.persona_env().is_err());
    resolved = urls();
    resolved.mcp = McpServiceUrl::from_static("ws://harness:8080");
    assert!(resolved.persona_env().is_err());
}

#[test]
fn invalid_git_base_fails_the_side_effect_free_enrollment_preflight() {
    for raw in [
        "http://localhost:8111",
        "http://user:pass@git:8080",
        "http://git:8080?token=bad",
        "ws://git:8080",
    ] {
        let mut resolved = urls();
        resolved.git = AgentGitServiceUrl::from_owned(raw);
        assert!(resolved.persona_env().is_err());
    }
}
