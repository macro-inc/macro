use mcp_auth_proxy::domain::redirect_uri::{RedirectTrust, RedirectUriPolicy};

use super::*;

#[test]
fn default_redirect_hosts_trust_cursor_web_agent_callbacks() {
    let policy = RedirectUriPolicy::new(DEFAULT_MCP_ALLOWED_REDIRECT_HOSTS);

    assert_eq!(
        policy.trust("https://cursor.com/agents/mcp/oauth/callback"),
        Some(RedirectTrust::Trusted)
    );
    assert_eq!(
        policy.trust("https://www.cursor.com/agents/mcp/oauth/callback"),
        Some(RedirectTrust::Trusted)
    );
}

#[tokio::test]
async fn configured_service_host_can_initialize_but_other_hosts_are_rejected() {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt as _;
    #[derive(Clone)]
    struct Empty;
    impl rmcp::ServerHandler for Empty {}
    let service = StreamableHttpService::new(
        || Ok(Empty),
        Arc::new(LocalSessionManager::default()),
        server_config("mcp.example.test".into(), "agent-harness-service".into()),
    );
    let app = Router::new().nest_service("/mcp", service);
    for (host, expected) in [
        ("agent-harness-service:8080", StatusCode::OK),
        ("unconfigured.test", StatusCode::FORBIDDEN),
    ] {
        let response = app.clone().oneshot(Request::post("/mcp")
            .header("host", host)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .body(Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#)).unwrap()).await.unwrap();
        assert_eq!(response.status(), expected);
    }
}
