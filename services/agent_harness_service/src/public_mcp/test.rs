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

/// Records whose flag decided a turn's kind.
#[derive(Default)]
struct OwnersAsked(std::sync::Mutex<Vec<String>>);

#[async_trait::async_trait]
impl agent_code_mode::domain::CodeModeKinds for OwnersAsked {
    async fn code_mode_kind(
        &self,
        _: agent_session::domain::model::AgentSessionId,
        owner: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> agent_code_mode::domain::CodeModeKind {
        self.0.lock().unwrap().push(owner.to_string());
        agent_code_mode::domain::CodeModeKind::Dialect
    }
}

/// A session's kind is read with its owner's flag, whoever's token made the
/// call; a session that can't be found has none.
#[tokio::test]
async fn a_sessions_kind_follows_its_owner() {
    use agent_session::domain::ports::AgentSessionRepo as _;
    use tool_service::SessionCodeModeKinds as _;
    let repo = agent_session::testing::InMemoryAgentSessionRepo::new();
    let session = agent_session::testing::test_agent_session(
        agent_session::domain::model::AgentSessionId::new(),
    );
    repo.insert_session(session.clone());
    let asked = Arc::new(OwnersAsked::default());
    let kinds = OwnerCodeModeKinds {
        sessions: repo.clone(),
        kinds: asked.clone(),
    };
    assert_eq!(
        kinds.session_kind(session.id.as_uuid()).await,
        Some(agent_code_mode::domain::CodeModeKind::Dialect)
    );
    assert_eq!(
        *asked.0.lock().unwrap(),
        [session.owner_user().unwrap().to_string()]
    );
    assert!(repo.find(session.id).await.unwrap().is_some());
    assert_eq!(kinds.session_kind(uuid::Uuid::now_v7()).await, None);
}
