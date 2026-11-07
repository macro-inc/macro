use std::sync::atomic::{AtomicUsize, Ordering};

use agent_egress::domain::error::EgressError;
use agent_egress::domain::model::{EgressTarget, ProxyRequest, ProxyResponse, SessionToken};
use agent_egress::domain::service::EgressService;
use bytes::Bytes;
use http::StatusCode;
use http_body_util::{BodyExt, Empty, Full};
use rmcp::transport::common::http_header::{HEADER_SESSION_ID, JSON_MIME_TYPE};
use serde_json::{Value, json};

use super::super::egress_mcp::EgressMcpClient;
use super::*;
use crate::domain::mcp::McpToolConnector;

/// The proxy's address, matching the path-prefix the in-process client strips.
const BASE_URL: &str = "https://gateway.example/agent-harness-egress";

fn empty_body() -> agent_egress::domain::model::ProxyBody {
    Empty::new().map_err(|never| match never {}).boxed_unsync()
}

fn full_body(bytes: Vec<u8>) -> agent_egress::domain::model::ProxyBody {
    Full::new(Bytes::from(bytes))
        .map_err(|never| match never {})
        .boxed_unsync()
}

fn json_response(status: StatusCode, body: Value) -> ProxyResponse {
    let mut response = http::Response::new(full_body(body.to_string().into_bytes()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        http::header::CONTENT_TYPE,
        HeaderValue::from_static(JSON_MIME_TYPE),
    );
    response
        .headers_mut()
        .insert(HEADER_SESSION_ID, HeaderValue::from_static("stub-session"));
    response
}

/// Speaks just enough MCP to finish a handshake, and can hold `initialize`
/// open so two callers overlap.
struct StubEgress {
    initializes: AtomicUsize,
    /// When set, `initialize` waits until the sender publishes `true`.
    hold: Option<tokio::sync::watch::Receiver<bool>>,
    started: tokio::sync::Notify,
}

impl StubEgress {
    fn open() -> Arc<Self> {
        Arc::new(Self {
            initializes: AtomicUsize::new(0),
            hold: None,
            started: tokio::sync::Notify::new(),
        })
    }

    fn held(hold: tokio::sync::watch::Receiver<bool>) -> Arc<Self> {
        Arc::new(Self {
            initializes: AtomicUsize::new(0),
            hold: Some(hold),
            started: tokio::sync::Notify::new(),
        })
    }

    fn initializes(&self) -> usize {
        self.initializes.load(Ordering::SeqCst)
    }
}

impl EgressService for StubEgress {
    async fn proxy(
        &self,
        _token: &SessionToken,
        _target: EgressTarget,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, EgressError> {
        if *request.method() != http::Method::POST {
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
            Some("initialize") => {
                self.initializes.fetch_add(1, Ordering::SeqCst);
                self.started.notify_one();
                if let Some(hold) = &self.hold {
                    let mut hold = hold.clone();
                    while !*hold.borrow() {
                        if hold.changed().await.is_err() {
                            break;
                        }
                    }
                }
                json!({
                    "protocolVersion": "2025-03-26",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "stub", "version": "0"},
                })
            }
            Some("tools/list") => json!({
                "tools": [{
                    "name": "echo",
                    "description": "Echoes",
                    "inputSchema": {"type": "object"},
                }],
            }),
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

fn server(name: &str, token: &str) -> agent_client_protocol::schema::v1::McpServerHttp {
    agent_client_protocol::schema::v1::McpServerHttp::new(name, format!("{BASE_URL}/mcp/{name}"))
        .headers(vec![agent_client_protocol::schema::v1::HttpHeader::new(
            "Authorization",
            format!("Bearer {token}"),
        )])
}

fn connector(egress: Arc<StubEgress>) -> AcpMcpConnector<EgressMcpClient<StubEgress>> {
    AcpMcpConnector::new(EgressMcpClient::new(egress, BASE_URL))
}

/// The harness advertises `Authorization: Bearer <session token>`; rmcp wants
/// the bare token and adds the scheme itself.
#[test]
fn a_bearer_authorization_header_becomes_the_bare_token() {
    assert_eq!(
        place_header("Authorization", "Bearer session-token"),
        Some(HeaderPlacement::BearerToken("session-token".to_owned()))
    );
    assert_eq!(
        place_header("authorization", "bearer  spaced-token "),
        Some(HeaderPlacement::BearerToken("spaced-token".to_owned()))
    );
}

#[test]
fn other_headers_are_sent_verbatim() {
    assert_eq!(
        place_header("X-Custom", "value"),
        Some(HeaderPlacement::Custom(
            HeaderName::from_static("x-custom"),
            HeaderValue::from_static("value"),
        ))
    );
    // A non-bearer authorization scheme is not something to strip.
    assert_eq!(
        place_header("Authorization", "Basic abc"),
        Some(HeaderPlacement::Custom(
            AUTHORIZATION,
            HeaderValue::from_static("Basic abc"),
        ))
    );
}

#[test]
fn invalid_headers_are_dropped() {
    assert_eq!(place_header("not a header", "x"), None);
    assert_eq!(place_header("X-Custom", "line\nbreak"), None);
}

/// Dropping the toolset must not drop the session: the next connect is the
/// same handshake, including when the bearer scheme differs only in case.
#[tokio::test]
async fn a_second_connect_reuses_the_open_session_and_its_tool_list() {
    let egress = StubEgress::open();
    let connector = connector(Arc::clone(&egress));

    let first = connector
        .connect(vec![server("hubspot", "session-token")])
        .await
        .expect("tools");
    assert_eq!(
        first
            .searchable_catalog()
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>(),
        ["mcp__hubspot__echo"]
    );
    let handshakes = egress.initializes();
    assert_eq!(handshakes, 1);

    drop(first);
    let second = connector
        .connect(vec![server("hubspot", "session-token")])
        .await
        .expect("pooled tools");
    assert_eq!(egress.initializes(), handshakes);
    assert!(!second.searchable_catalog().is_empty());

    // `bearer` and `Bearer` are the same session token.
    let _third = connector
        .connect(vec![
            agent_client_protocol::schema::v1::McpServerHttp::new(
                "hubspot",
                format!("{BASE_URL}/mcp/hubspot"),
            )
            .headers(vec![agent_client_protocol::schema::v1::HttpHeader::new(
                "authorization",
                "bearer session-token",
            )]),
        ])
        .await
        .expect("same token");
    assert_eq!(egress.initializes(), handshakes);
}

/// The agent and the catalog dial the same server at once; one handshake
/// serves both.
#[tokio::test]
async fn overlapping_connects_share_one_handshake() {
    let (release, hold) = tokio::sync::watch::channel(false);
    let egress = StubEgress::held(hold);
    let connector = connector(Arc::clone(&egress));

    let first = tokio::spawn({
        let connector = connector.clone();
        async move {
            connector
                .connect(vec![server("linear", "session-token")])
                .await
        }
    });
    egress.started.notified().await;

    let second = tokio::spawn({
        let connector = connector.clone();
        async move {
            connector
                .connect(vec![server("linear", "session-token")])
                .await
        }
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(egress.initializes(), 1, "the second caller joined the dial");

    release.send(true).expect("the hold is open");
    let (first, second) = tokio::join!(first, second);
    assert!(first.expect("task").is_some());
    assert!(second.expect("task").is_some());
    assert_eq!(egress.initializes(), 1);
}

/// Teardown forgets the token's sessions. A different token never shared them.
#[tokio::test]
async fn release_and_a_different_token_each_dial_again() {
    let egress = StubEgress::open();
    let connector = connector(Arc::clone(&egress));

    let tools = connector
        .connect(vec![server("hubspot", "session-token")])
        .await
        .expect("tools");
    drop(tools);
    assert_eq!(egress.initializes(), 1);

    connector.release("session-token");
    let _redialed = connector
        .connect(vec![server("hubspot", "session-token")])
        .await
        .expect("redialed after release");
    assert_eq!(egress.initializes(), 2);

    let _other = connector
        .connect(vec![server("hubspot", "other-token")])
        .await
        .expect("a different session");
    assert_eq!(egress.initializes(), 3);
}

#[tokio::test]
async fn idle_pool_entries_are_redialed_without_invalidating_active_toolsets() {
    let egress = StubEgress::open();
    let connector = connector(Arc::clone(&egress));
    let active = connector
        .connect(vec![server("idle", "token")])
        .await
        .expect("tools");
    {
        let mut pool = connector.pool.lock();
        for entry in pool.entries.values_mut() {
            if let Entry::Ready { touched, .. } = entry {
                *touched = Instant::now() - POOL_IDLE_TTL;
            }
        }
    }
    let _next = connector
        .connect(vec![server("idle", "token")])
        .await
        .expect("fresh tools");
    assert_eq!(egress.initializes(), 2);
    assert!(!active.searchable_catalog().is_empty());
}

#[tokio::test]
async fn pool_evicts_oldest_when_at_capacity() {
    let egress = StubEgress::open();
    let connector = connector(Arc::clone(&egress));
    for index in 0..=MAX_POOLED_SERVERS {
        connector
            .connect(vec![server("bounded", &format!("token-{index}"))])
            .await
            .expect("tools");
    }
    assert_eq!(connector.pool.lock().entries.len(), MAX_POOLED_SERVERS);
    assert!(
        !connector
            .pool
            .lock()
            .entries
            .contains_key(&prepare(&server("bounded", "token-0")).0)
    );
}
