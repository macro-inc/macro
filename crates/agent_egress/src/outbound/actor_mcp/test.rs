use super::*;
use rmcp::{
    ServerHandler,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ServerCapabilities,
        ServerConfig,
    },
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Clone, Default)]
struct StatefulTool(Arc<AtomicUsize>);

impl ServerHandler for StatefulTool {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
    }
    async fn call_tool(
        &self,
        _: CallToolRequestParams,
        _: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResponse, rmcp::ErrorData> {
        Ok(CallToolResult::success(vec![ContentBlock::text(
            (self.0.fetch_add(1, Ordering::SeqCst) + 1).to_string(),
        )])
        .into())
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
    let transport = HttpActorMcpTransport::new(AddressPolicy::AnyAddress).unwrap();
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

/// An MCP endpoint that initializes normally and answers every `tools/call`
/// with HTTP 429 and `Retry-After: 2`, as GitHub's MCP endpoint does under a
/// burst.
async fn rate_limited_tool_call(
    axum::Json(message): axum::Json<Value>,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    match message["method"].as_str() {
        Some("initialize") => (
            [("mcp-session-id", "rate-limited-session")],
            axum::Json(json!({
                "jsonrpc": "2.0",
                "id": message["id"],
                "result": {
                    "protocolVersion": message["params"]["protocolVersion"],
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "rate-limited", "version": "1"},
                },
            })),
        )
            .into_response(),
        Some("tools/call") => (
            http::StatusCode::TOO_MANY_REQUESTS,
            [(http::header::RETRY_AFTER, "2")],
            "slow down",
        )
            .into_response(),
        _ => http::StatusCode::ACCEPTED.into_response(),
    }
}

#[tokio::test]
async fn an_upstream_429_is_a_typed_rate_limit_carrying_retry_after() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = axum::Router::new().route("/mcp", axum::routing::post(rate_limited_tool_call));
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let transport = HttpActorMcpTransport::new(AddressPolicy::AnyAddress).unwrap();

    let result = transport
        .exchange(
            AgentSessionId::new(),
            MacroUserIdStr::try_from_email("owner@example.com").unwrap(),
            UpstreamCall::bearer_over_local_cleartext(
                url::Url::parse(&format!("http://{address}/mcp")).unwrap(),
                crate::domain::model::BearerToken::new("test-credential"),
            ),
            json!({"method":"tools/call","params":{"name":"pull_request_read","arguments":{}}}),
        )
        .await;

    match result {
        Err(EgressError::RateLimited { retry_after }) => {
            assert_eq!(retry_after, Some(std::time::Duration::from_secs(2)));
        }
        other => panic!("expected a rate limit, got {other:?}"),
    }
    server.abort();
}

#[test]
fn retry_after_reads_seconds_and_http_dates() {
    assert_eq!(retry_after(" 2 "), Some(std::time::Duration::from_secs(2)));
    let in_a_minute =
        httpdate::fmt_http_date(std::time::SystemTime::now() + std::time::Duration::from_secs(60));
    let wait = retry_after(&in_a_minute).unwrap();
    assert!(
        wait > std::time::Duration::from_secs(55) && wait <= std::time::Duration::from_secs(60),
        "{wait:?}"
    );
    assert_eq!(
        retry_after("Wed, 21 Oct 2015 07:28:00 GMT"),
        Some(std::time::Duration::ZERO)
    );
    assert_eq!(retry_after("soon"), None);
}
