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
async fn configured_transport_hosts_pass_rebinding_checks_but_unrelated_hosts_do_not() {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[derive(Clone)]
    struct Server;
    impl rmcp::ServerHandler for Server {}

    for service_host in ["agent_harness_service", "agent-harness-service"] {
        let config = server_config("mcp.example.test".into(), service_host.into());
        let service = StreamableHttpService::new(
            || Ok(Server),
            Arc::new(LocalSessionManager::default()),
            config,
        );
        let router = axum::Router::new().nest_service("/mcp", service);
        for (host, expected) in [
            (format!("{service_host}:8080"), 200),
            ("localhost:32443".to_owned(), 200),
            ("mcp.example.test:443".to_owned(), 200),
            (format!("{service_host}.example.com:8080"), 403),
            ("untrusted.example.com:8080".to_owned(), 403),
        ] {
            let request = Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("host", &host)
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .body(Body::from(
                    serde_json::json!({
                        "jsonrpc": "2.0", "id": 1, "method": "initialize",
                        "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                   "clientInfo": {"name": "host-regression", "version": "1"}}
                    })
                    .to_string(),
                ))
                .unwrap();
            let response = router.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status().as_u16(), expected, "{host}");
        }
    }
}
