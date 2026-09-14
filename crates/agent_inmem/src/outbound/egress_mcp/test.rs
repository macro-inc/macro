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

/// The proxy's address as a deployment behind the shared gateway configures
/// it: a path on a host serving many services. What broke was reading a route
/// off a URL built on one of these.
const BASE_URL: &str = "https://gateway.example/agent-harness-egress";

fn hubspot() -> EgressTarget {
    EgressTarget::McpServer(McpDestination::Connected(
        McpServerSlug::parse("hubspot").expect("slug"),
    ))
}

#[tokio::test]
async fn a_handshake_and_tool_listing_go_through_the_service_as_the_session() {
    let egress = Arc::new(StubEgress::default());
    let client = EgressMcpClient::new(Arc::clone(&egress), BASE_URL);
    let config = StreamableHttpClientTransportConfig::with_uri(format!("{BASE_URL}/mcp/hubspot"))
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
    let client = EgressMcpClient::new(Arc::clone(&egress), BASE_URL);

    let error = client
        .post_message(
            Arc::from("https://gateway.example/agent-harness-egress/git/info/refs"),
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
    let client = EgressMcpClient::new(Arc::clone(&egress), BASE_URL);

    let error = client
        .delete_session(
            Arc::from("https://gateway.example/agent-harness-egress/mcp/hubspot"),
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
    let client = EgressMcpClient::new(Arc::clone(&egress), BASE_URL);

    // The stub answers DELETE with 405, which the client reads as "nothing to
    // delete", so this exercises the address step alone.
    client
        .delete_session(
            Arc::from("https://gateway.example/agent-harness-egress/mcp-macro"),
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

/// A `delete_session` the stub answers with 405, which the client reads as
/// "nothing to delete": the cheapest way to exercise the address step alone.
async fn address_only(
    egress: &Arc<StubEgress>,
    base_url: &str,
    uri: &'static str,
) -> Result<(), CallError> {
    EgressMcpClient::new(Arc::clone(egress), base_url)
        .delete_session(
            Arc::from(uri),
            Arc::from("stub-session"),
            Some("session-token".to_owned()),
            HashMap::new(),
        )
        .await
}

#[tokio::test]
async fn a_route_under_the_proxys_own_path_prefix_is_read_off_it() {
    let egress = Arc::new(StubEgress::default());

    address_only(
        &egress,
        BASE_URL,
        "https://gateway.example/agent-harness-egress/mcp/hubspot",
    )
    .await
    .expect("405 is fine");

    assert_eq!(egress.seen(), vec![("session-token".to_owned(), hubspot())]);
}

#[tokio::test]
async fn a_base_url_with_no_path_reads_the_same_routes() {
    let egress = Arc::new(StubEgress::default());

    address_only(
        &egress,
        "http://localhost:8102",
        "http://localhost:8102/mcp/hubspot",
    )
    .await
    .expect("405 is fine");

    assert_eq!(egress.seen(), vec![("session-token".to_owned(), hubspot())]);
}

#[tokio::test]
async fn a_trailing_slash_on_the_base_url_does_not_hide_the_route() {
    let egress = Arc::new(StubEgress::default());

    address_only(
        &egress,
        "https://gateway.example/agent-harness-egress/",
        "https://gateway.example/agent-harness-egress/mcp/hubspot",
    )
    .await
    .expect("405 is fine");

    assert_eq!(egress.seen(), vec![("session-token".to_owned(), hubspot())]);
}

#[tokio::test]
async fn a_url_that_is_not_under_the_proxys_base_is_refused() {
    let egress = Arc::new(StubEgress::default());

    let error = address_only(&egress, BASE_URL, "https://gateway.example/mcp/hubspot")
        .await
        .expect_err("not this proxy");
    assert!(
        matches!(
            error,
            StreamableHttpError::Client(EgressCallError::NotAnEgressUrl(_))
        ),
        "{error:?}"
    );
    assert!(egress.seen().is_empty());
}
