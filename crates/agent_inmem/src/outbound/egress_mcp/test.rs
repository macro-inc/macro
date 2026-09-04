use std::sync::Mutex;

use agent_egress::domain::model::McpServerSlug;
use mcp_toolset::client_info;
use rmcp::ServiceExt as _;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde_json::{Value, json};

use super::*;

/// An egress service standing in for the proxy: it records who called for
/// what and speaks just enough MCP to complete a handshake and list tools.
#[derive(Default)]
struct StubEgress {
    seen: Mutex<Vec<(String, EgressTarget)>>,
}

impl StubEgress {
    fn seen(&self) -> Vec<(String, EgressTarget)> {
        self.seen.lock().expect("lock").clone()
    }
}

fn json_response(status: StatusCode, body: Value) -> ProxyResponse {
    let mut response = http::Response::new(full_body(body.to_string().into_bytes()));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(JSON_MIME_TYPE));
    response
        .headers_mut()
        .insert(HEADER_SESSION_ID, HeaderValue::from_static("stub-session"));
    response
}

impl EgressService for StubEgress {
    async fn proxy(
        &self,
        token: &SessionToken,
        target: EgressTarget,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, EgressError> {
        self.seen
            .lock()
            .expect("lock")
            .push((token.as_str().to_owned(), target));

        if *request.method() != Method::POST {
            let mut response = http::Response::new(empty_body());
            *response.status_mut() = StatusCode::METHOD_NOT_ALLOWED;
            return Ok(response);
        }
        let body = request
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let call: Value = serde_json::from_slice(&body).expect("json-rpc");
        let id = call.get("id").cloned();
        let result = match call["method"].as_str() {
            Some("initialize") => json!({
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "stub", "version": "0"},
            }),
            Some("tools/list") => json!({
                "tools": [{
                    "name": "echo",
                    "description": "Echoes",
                    "inputSchema": {"type": "object"},
                }],
            }),
            // Notifications carry no id and are acknowledged with nothing.
            _ if id.is_none() => {
                let mut response = http::Response::new(empty_body());
                *response.status_mut() = StatusCode::ACCEPTED;
                return Ok(response);
            }
            _ => {
                return Ok(json_response(
                    StatusCode::NOT_FOUND,
                    json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "no such method"}}),
                ));
            }
        };
        Ok(json_response(
            StatusCode::OK,
            json!({"jsonrpc": "2.0", "id": id, "result": result}),
        ))
    }
}

fn hubspot() -> EgressTarget {
    EgressTarget::McpServer(McpDestination::Connected(
        McpServerSlug::parse("hubspot").expect("slug"),
    ))
}

#[tokio::test]
async fn a_handshake_and_tool_listing_go_through_the_service_as_the_session() {
    let egress = Arc::new(StubEgress::default());
    let client = EgressMcpClient::new(Arc::clone(&egress));
    let config =
        StreamableHttpClientTransportConfig::with_uri("http://egress.internal/mcp/hubspot")
            .auth_header("session-token");
    let transport = StreamableHttpClientTransport::with_client(client, config);

    let server = client_info().serve(transport).await.expect("handshake");
    let tools = server.list_all_tools().await.expect("tools/list");
    assert_eq!(
        tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>(),
        ["echo"]
    );
    server.cancel().await.expect("close");

    let seen = egress.seen();
    assert!(
        seen.len() >= 3,
        "initialize, initialized, tools/list: {seen:?}"
    );
    for (token, target) in &seen {
        assert_eq!(token, "session-token");
        assert_eq!(*target, hubspot());
    }
}

#[tokio::test]
async fn a_url_off_the_proxy_routes_is_refused_before_the_service_is_called() {
    let egress = Arc::new(StubEgress::default());
    let client = EgressMcpClient::new(Arc::clone(&egress));

    let error = client
        .post_message(
            Arc::from("http://egress.internal/git/info/refs"),
            ClientJsonRpcMessage::notification(
                rmcp::model::ClientNotification::InitializedNotification(Default::default()),
            ),
            None,
            Some("session-token".to_owned()),
            HashMap::new(),
        )
        .await
        .expect_err("not an MCP route");
    assert!(
        matches!(
            error,
            StreamableHttpError::Client(EgressCallError::NotAnEgressUrl(_))
        ),
        "{error:?}"
    );
    assert!(egress.seen().is_empty());
}

#[tokio::test]
async fn a_server_entry_without_a_token_is_refused_before_the_service_is_called() {
    let egress = Arc::new(StubEgress::default());
    let client = EgressMcpClient::new(Arc::clone(&egress));

    let error = client
        .delete_session(
            Arc::from("http://egress.internal/mcp/hubspot"),
            Arc::from("stub-session"),
            None,
            HashMap::new(),
        )
        .await
        .expect_err("no token");
    assert!(
        matches!(
            error,
            StreamableHttpError::Client(EgressCallError::NoSessionToken)
        ),
        "{error:?}"
    );
    assert!(egress.seen().is_empty());
}

#[tokio::test]
async fn the_macro_route_names_macros_own_server() {
    let egress = Arc::new(StubEgress::default());
    let client = EgressMcpClient::new(Arc::clone(&egress));

    // The stub answers DELETE with 405, which the client reads as "nothing to
    // delete", so this exercises the address step alone.
    client
        .delete_session(
            Arc::from("http://egress.internal/mcp-macro"),
            Arc::from("stub-session"),
            Some("session-token".to_owned()),
            HashMap::new(),
        )
        .await
        .expect("405 is fine");
    assert_eq!(
        egress.seen(),
        vec![(
            "session-token".to_owned(),
            EgressTarget::McpServer(McpDestination::Macro)
        )]
    );
}
