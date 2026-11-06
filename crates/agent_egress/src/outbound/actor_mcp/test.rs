use super::*;
use rmcp::{
    ServerHandler,
    model::{CallToolRequestParams, CallToolResult, Content, ServerCapabilities, ServerInfo},
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Default)]
struct StatefulTool(Arc<AtomicUsize>);

impl ServerHandler for StatefulTool {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
    }
    async fn call_tool(
        &self,
        _: CallToolRequestParams,
        _: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        Ok(CallToolResult::success(vec![Content::text(
            (self.0.fetch_add(1, Ordering::SeqCst) + 1).to_string(),
        )]))
    }
}

#[tokio::test]
async fn state_is_preserved_within_one_actor_and_isolated_across_actors() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut config = StreamableHttpServerConfig::default();
    config.json_response = true;
    let app = axum::Router::new().nest_service(
        "/mcp",
        StreamableHttpService::new(
            || Ok(StatefulTool::default()),
            Arc::new(LocalSessionManager::default()),
            config,
        ),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let transport = HttpActorMcpTransport::new().unwrap();
    let session = AgentSessionId::new();
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let requester = MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    for (actor, expected) in [
        (requester.clone(), "1"),
        (requester.clone(), "2"),
        (owner, "1"),
        (requester.clone(), "3"),
    ] {
        let upstream = UpstreamCall::bearer_over_local_cleartext(
            url::Url::parse(&format!("http://{address}/mcp")).unwrap(),
            crate::domain::model::BearerToken::new("same-test-credential"),
        );
        let result = transport
            .exchange(
                session,
                actor,
                upstream,
                json!({"method":"tools/call","params":{"name":"increment","arguments":{}}}),
            )
            .await
            .unwrap();
        assert_eq!(result["content"][0]["text"], expected);
    }
    let malformed = transport
        .exchange(
            session,
            requester,
            UpstreamCall::bearer_over_local_cleartext(
                url::Url::parse(&format!("http://{address}/mcp")).unwrap(),
                crate::domain::model::BearerToken::new("same-test-credential"),
            ),
            json!({"method":"tools/call","params":{"name":"increment","arguments":{},"_meta":"invalid"}}),
        )
        .await;
    assert!(
        malformed.is_err(),
        "malformed metadata must not panic or execute"
    );
    server.abort();
}
